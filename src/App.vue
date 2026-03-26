<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'

/* ─── types ─── */
type TabKey = 'fav' | 'add' | 'home' | 'plan' | 'list'
type MealSlot = 'mittag' | 'abend'
type Dish = { id: number; name: string; description: string; imageUrl: string | null; portions: number }
type DishDetail = Dish & {
  ingredients: Array<{ name: string; amount: string }>
  steps: Array<{ stepIndex: number; content: string }>
}
type ShoppingItem = { id: number; title: string; isDone: number }
type MealEntry = { id: number; day: number; slot: MealSlot; dishId: number | null; dishName: string | null; imageUrl: string | null }

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3001/api'
const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const DAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const SLOTS: Array<{ key: MealSlot; label: string }> = [
  { key: 'mittag', label: 'Mittag' },
  { key: 'abend', label: 'Abend' },
]

/* ─── global state ─── */
const activeTab = ref<TabKey>('home')
const dishes = ref<Dish[]>([])
const favorites = ref<Dish[]>([])
const shopping = ref<ShoppingItem[]>([])
const mealPlan = ref<MealEntry[]>([])
const detail = ref<DishDetail | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const isDeleting = ref(false)
const deleteConfirm = ref(false)
const newItem = ref('')
const imageFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const editingId = ref<number | null>(null)
const toast = ref<{ msg: string; ok: boolean } | null>(null)
let toastTimer = 0

// detail sheet swipe
const sheetExpanded = ref(false)
const swipeDragOffset = ref(0)
const swipeIsDragging = ref(false)
let swipeTouchStartY = 0
let swipeStartOffset = 0

// portion scaler
const viewPortions = ref(1)

// meal plan picker
const pickingSlot = ref<{ day: number; slot: MealSlot } | null>(null)

/* ─── form ─── */
const form = reactive({
  name: '',
  description: '',
  portions: 1,
  ingredients: [{ name: '', amount: '' }],
  steps: [{ content: '' }],
})

/* ─── computed ─── */
const pendingCount = computed(() => shopping.value.filter((s) => s.isDone === 0).length)
const isEditMode = computed(() => editingId.value !== null)
const isFavorited = computed(() =>
  detail.value ? favorites.value.some((f) => f.id === detail.value!.id) : false,
)
const scaleFactor = computed(() => {
  if (!detail.value || detail.value.portions <= 0) return 1
  return viewPortions.value / detail.value.portions
})
const mealPlanMap = computed(() => {
  const m = new Map<string, MealEntry>()
  for (const e of mealPlan.value) m.set(`${e.day}-${e.slot}`, e)
  return m
})

/* ─── helpers ─── */
function setToast(msg: string, ok = true) {
  clearTimeout(toastTimer)
  toast.value = { msg, ok }
  toastTimer = window.setTimeout(() => (toast.value = null), 3000)
}

function scaleAmount(raw: string, factor: number): string {
  if (Math.abs(factor - 1) < 0.01) return raw
  const m = raw.trim().match(/^(\d+(?:[.,]\d+)?(?:\/\d+)?)\s*(.*)$/)
  if (!m) return raw
  let num: number
  if (m[1].includes('/')) {
    const p = m[1].split('/')
    num = Number(p[0]) / Number(p[1])
  } else {
    num = parseFloat(m[1].replace(',', '.'))
  }
  if (isNaN(num)) return raw
  const val = Math.round(num * factor * 100) / 100
  const display = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)
  return m[2] ? `${display} ${m[2]}` : display
}

function resetForm() {
  form.name = ''
  form.description = ''
  form.portions = 1
  form.ingredients = [{ name: '', amount: '' }]
  form.steps = [{ content: '' }]
  editingId.value = null
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imageFile.value = null
  imagePreview.value = null
}

/* ─── data loading ─── */
async function loadDishes(background = false) {
  if (!background) isLoading.value = true
  try {
    const r = await fetch(`${API}/dishes`)
    if (r.ok) dishes.value = await r.json()
  } finally {
    if (!background) isLoading.value = false
  }
}

async function loadFavorites(background = false) {
  try {
    const r = await fetch(`${API}/favorites`)
    if (r.ok) favorites.value = await r.json()
  } catch {
    if (!background) setToast('Favoriten konnten nicht geladen werden.', false)
  }
}

async function loadShopping(background = false) {
  try {
    const r = await fetch(`${API}/shopping-items`)
    if (r.ok) shopping.value = await r.json()
  } catch {
    if (!background) setToast('Einkaufsliste konnte nicht geladen werden.', false)
  }
}

async function loadMealPlan(background = false) {
  try {
    const r = await fetch(`${API}/meal-plan`)
    if (r.ok) mealPlan.value = await r.json()
  } catch {
    if (!background) setToast('Wochenplan konnte nicht geladen werden.', false)
  }
}

async function refreshDetail() {
  if (!detail.value) return
  try {
    const r = await fetch(`${API}/dishes/${detail.value.id}`)
    if (r.ok) {
      const updated: DishDetail = await r.json()
      detail.value = updated
    }
  } catch {}
}

async function loadAll(background = false) {
  await Promise.all([loadDishes(background), loadFavorites(background), loadShopping(background), loadMealPlan(background)])
}

/* ─── detail sheet ─── */
async function openDetail(dish: Dish) {
  sheetExpanded.value = false
  swipeDragOffset.value = 0
  swipeIsDragging.value = false
  deleteConfirm.value = false
  viewPortions.value = dish.portions > 0 ? dish.portions : 1
  const r = await fetch(`${API}/dishes/${dish.id}`)
  if (r.ok) detail.value = await r.json()
}

function closeDetail() {
  detail.value = null
  sheetExpanded.value = false
  swipeDragOffset.value = 0
  swipeIsDragging.value = false
  deleteConfirm.value = false
}

/* ─── swipe gestures ─── */
function onSheetTouchStart(e: TouchEvent) {
  swipeTouchStartY = e.touches[0].clientY
  swipeStartOffset = swipeDragOffset.value
  swipeIsDragging.value = true
}

function onSheetTouchMove(e: TouchEvent) {
  if (!swipeIsDragging.value) return
  const dy = e.touches[0].clientY - swipeTouchStartY
  const base = sheetExpanded.value ? 0 : 0
  swipeDragOffset.value = Math.max(base - 80, Math.min(400, swipeStartOffset + dy))
  if (dy < 0 && !sheetExpanded.value) e.preventDefault()
}

function onSheetTouchEnd() {
  swipeIsDragging.value = false
  if (swipeDragOffset.value < -40 && !sheetExpanded.value) {
    sheetExpanded.value = true
    swipeDragOffset.value = 0
  } else if (swipeDragOffset.value > 60 && sheetExpanded.value) {
    sheetExpanded.value = false
    swipeDragOffset.value = 0
  } else if (swipeDragOffset.value > 120 && !sheetExpanded.value) {
    closeDetail()
  } else {
    swipeDragOffset.value = 0
  }
}

function toggleSheetExpanded() {
  sheetExpanded.value = !sheetExpanded.value
  swipeDragOffset.value = 0
}

/* ─── dish CRUD ─── */
function openEditFromDetail() {
  if (!detail.value) return
  editingId.value = detail.value.id
  form.name = detail.value.name
  form.description = detail.value.description
  form.portions = detail.value.portions > 0 ? detail.value.portions : 1
  form.ingredients = detail.value.ingredients.length
    ? detail.value.ingredients.map((i) => ({ ...i }))
    : [{ name: '', amount: '' }]
  form.steps = detail.value.steps.length
    ? detail.value.steps.map((s) => ({ content: s.content }))
    : [{ content: '' }]
  imageFile.value = null
  imagePreview.value = null
  closeDetail()
  activeTab.value = 'add'
}

async function saveDish() {
  if (!form.name.trim()) { setToast('Name ist erforderlich.', false); return }
  isSaving.value = true
  try {
    const fd = new FormData()
    fd.append('name', form.name.trim())
    fd.append('description', form.description.trim())
    fd.append('portions', String(form.portions))
    if (imageFile.value) fd.append('image', imageFile.value)
    if (isEditMode.value) fd.append('keepExistingImage', imageFile.value ? 'false' : 'true')

    const url = isEditMode.value ? `${API}/dishes/${editingId.value}` : `${API}/dishes`
    const method = isEditMode.value ? 'PUT' : 'POST'
    const r1 = await fetch(url, { method, body: fd })
    if (!r1.ok) { setToast('Speichern fehlgeschlagen.', false); return }
    const dishId = isEditMode.value ? editingId.value! : (await r1.json()).id

    const ings = form.ingredients.filter((i) => i.name.trim())
    const stps = form.steps.filter((s) => s.content.trim())
    await fetch(`${API}/dishes/${dishId}/details`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredients: ings, steps: stps }),
    })

    setToast(isEditMode.value ? 'Gericht aktualisiert!' : 'Gericht gespeichert!')
    resetForm()
    await loadDishes(true)
    await loadFavorites(true)
    activeTab.value = 'home'
  } finally {
    isSaving.value = false
  }
}

async function deleteDish() {
  if (!detail.value) return
  isDeleting.value = true
  try {
    const r = await fetch(`${API}/dishes/${detail.value.id}`, { method: 'DELETE' })
    if (r.ok) {
      setToast('Gericht gelöscht.')
      closeDetail()
      await loadAll(true)
    } else {
      setToast('Löschen fehlgeschlagen.', false)
    }
  } finally {
    isDeleting.value = false
    deleteConfirm.value = false
  }
}

/* ─── favorites ─── */
async function toggleFavorite() {
  if (!detail.value) return
  const id = detail.value.id
  const method = isFavorited.value ? 'DELETE' : 'POST'
  await fetch(`${API}/favorites/${id}`, { method })
  await loadFavorites(true)
  setToast(isFavorited.value ? 'Aus Favoriten entfernt.' : 'Zu Favoriten hinzugefügt!')
}

/* ─── shopping ─── */
async function addShoppingItem() {
  const title = newItem.value.trim()
  if (!title) return
  const r = await fetch(`${API}/shopping-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (r.ok) { newItem.value = ''; await loadShopping(true) }
}

async function toggleShoppingItem(item: ShoppingItem) {
  await fetch(`${API}/shopping-items/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isDone: item.isDone === 0 ? 1 : 0 }),
  })
  await loadShopping(true)
}

async function deleteShoppingItem(id: number) {
  await fetch(`${API}/shopping-items/${id}`, { method: 'DELETE' })
  await loadShopping(true)
}

async function clearDoneItems() {
  const done = shopping.value.filter((s) => s.isDone === 1)
  await Promise.all(done.map((s) => fetch(`${API}/shopping-items/${s.id}`, { method: 'DELETE' })))
  await loadShopping(true)
}

async function addIngredientToShop(ing: { name: string; amount: string }) {
  const scaled = scaleAmount(ing.amount, scaleFactor.value)
  const title = scaled ? `${scaled} ${ing.name}` : ing.name
  await fetch(`${API}/shopping-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim() }),
  })
  await loadShopping(true)
  setToast(`${ing.name} hinzugefügt!`)
}

async function addAllIngredientsToShop() {
  if (!detail.value?.ingredients.length) return
  for (const ing of detail.value.ingredients) await addIngredientToShop(ing)
  setToast(`${detail.value.ingredients.length} Zutaten zur Einkaufsliste!`)
}

/* ─── meal plan ─── */
function openPicker(day: number, slot: MealSlot) {
  pickingSlot.value = { day, slot }
}

async function assignDish(dishId: number | null) {
  if (!pickingSlot.value) return
  const { day, slot } = pickingSlot.value
  await fetch(`${API}/meal-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, slot, dishId }),
  })
  pickingSlot.value = null
  await loadMealPlan(true)
}

async function clearMealSlot(day: number, slot: MealSlot) {
  await fetch(`${API}/meal-plan`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, slot, dishId: null }),
  })
  await loadMealPlan(true)
}

async function clearWholeWeek() {
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    for (const slot of ['mittag', 'abend'] as MealSlot[]) {
      const entry = mealPlanMap.value.get(`${day}-${slot}`)
      if (entry) {
        await fetch(`${API}/meal-plan`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day, slot, dishId: null }),
        })
      }
    }
  }
  await loadMealPlan(true)
  setToast('Wochenplan geleert.')
}

/* ─── image ─── */
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  imageFile.value = file
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imagePreview.value = URL.createObjectURL(file)
}

function removeImage() {
  imageFile.value = null
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imagePreview.value = null
  if (fileInput.value) fileInput.value.value = ''
}

/* ─── form helpers ─── */
function addIngredient() { form.ingredients.push({ name: '', amount: '' }) }
function removeIngredient(i: number) { form.ingredients.splice(i, 1) }
function addStep() { form.steps.push({ content: '' }) }
function removeStep(i: number) { form.steps.splice(i, 1) }

/* ─── lifecycle ─── */
let pollTimer = 0
onMounted(async () => {
  await loadAll()
  pollTimer = window.setInterval(async () => {
    await loadAll(true)
    await refreshDetail()
  }, 5000)
})
onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <!-- Toast -->
  <Transition name="toast">
    <div v-if="toast" class="toast" :class="toast.ok ? 'toast--ok' : 'toast--err'">
      {{ toast.msg }}
    </div>
  </Transition>

  <!-- Main scroll -->
  <div class="page-scroll">
    <!-- HOME: Kachel-Liste -->
    <section v-if="activeTab === 'home'" class="tab-section">
      <header class="page-header">
        <h1>Meine Rezepte</h1>
        <span class="pill">{{ dishes.length }}</span>
      </header>
      <div v-if="isLoading" class="empty-state"><span class="spinner" /></div>
      <div v-else-if="dishes.length === 0" class="empty-state">
        <p>Noch keine Gerichte. Tippe auf&nbsp;<strong>+</strong> um zu starten.</p>
      </div>
      <TransitionGroup v-else name="list" tag="div" class="tile-grid">
        <button
          v-for="dish in dishes"
          :key="dish.id"
          class="tile"
          @click="openDetail(dish)"
        >
          <div class="tile-img">
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
            <span v-else class="tile-placeholder">🍽️</span>
          </div>
          <div class="tile-info">
            <span class="tile-name">{{ dish.name }}</span>
            <span v-if="dish.description" class="tile-desc">{{ dish.description }}</span>
            <span class="tile-arrow">›</span>
          </div>
        </button>
      </TransitionGroup>
    </section>

    <!-- FAVORITEN -->
    <section v-else-if="activeTab === 'fav'" class="tab-section">
      <header class="page-header">
        <h1>Favoriten</h1>
        <span class="pill">{{ favorites.length }}</span>
      </header>
      <div v-if="favorites.length === 0" class="empty-state">
        <p>Noch keine Favoriten. Öffne ein Rezept und tippe auf ★.</p>
      </div>
      <TransitionGroup v-else name="list" tag="div" class="tile-grid">
        <button
          v-for="dish in favorites"
          :key="dish.id"
          class="tile"
          @click="openDetail(dish)"
        >
          <div class="tile-img">
            <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
            <span v-else class="tile-placeholder">🍽️</span>
          </div>
          <div class="tile-info">
            <span class="tile-name">{{ dish.name }}</span>
            <span v-if="dish.description" class="tile-desc">{{ dish.description }}</span>
            <span class="tile-arrow">›</span>
          </div>
        </button>
      </TransitionGroup>
    </section>

    <!-- HINZUFÜGEN / BEARBEITEN -->
    <section v-else-if="activeTab === 'add'" class="tab-section">
      <header class="page-header header-row">
        <h1>{{ isEditMode ? 'Bearbeiten' : 'Neues Gericht' }}</h1>
        <button v-if="isEditMode" class="cancel-edit-btn" @click="resetForm(); activeTab = 'home'">
          Abbrechen
        </button>
      </header>

      <form class="dish-form" @submit.prevent="saveDish">
        <!-- Abschnitt 1: Allgemein -->
        <div class="form-section">
          <div class="form-section-label">1 — Allgemein</div>
          <div class="field">
            <label class="field-label">Name *</label>
            <input v-model="form.name" class="field-input" placeholder="z. B. Pasta Bolognese" required />
          </div>
          <div class="field">
            <label class="field-label">Beschreibung</label>
            <textarea v-model="form.description" class="field-textarea" rows="2" placeholder="Kurze Beschreibung…" />
          </div>
          <div class="field">
            <label class="field-label">Portionen (Grundrezept)</label>
            <div class="portion-stepper">
              <button type="button" class="portion-btn" :disabled="form.portions <= 1" @click="form.portions = Math.max(1, form.portions - 1)">−</button>
              <span class="portion-count">{{ form.portions }}</span>
              <button type="button" class="portion-btn" @click="form.portions += 1">+</button>
            </div>
          </div>
        </div>

        <!-- Abschnitt 2: Bild -->
        <div class="form-section">
          <div class="form-section-label">2 — Foto</div>
          <div v-if="imagePreview" class="img-preview-wrap">
            <img :src="imagePreview" class="img-preview" alt="Vorschau" />
            <button type="button" class="remove-img-btn" @click="removeImage">× Bild entfernen</button>
          </div>
          <label v-else class="file-label">
            <span>📷 Foto auswählen</span>
            <input ref="fileInput" type="file" accept="image/*" class="file-input" @change="onFileChange" />
          </label>
        </div>

        <!-- Abschnitt 3: Zutaten -->
        <div class="form-section">
          <div class="form-section-label">3 — Zutaten</div>
          <div v-for="(ing, i) in form.ingredients" :key="i" class="ingredient-row">
            <input v-model="ing.amount" class="field-input ing-amount" placeholder="Menge" />
            <input v-model="ing.name" class="field-input ing-name" placeholder="Zutat" />
            <button type="button" class="rm-btn" @click="removeIngredient(i)">×</button>
          </div>
          <button type="button" class="add-row-btn" @click="addIngredient">+ Zutat</button>
        </div>

        <!-- Abschnitt 4: Schritte -->
        <div class="form-section">
          <div class="form-section-label">4 — Rezeptschritte</div>
          <div v-for="(step, i) in form.steps" :key="i" class="step-row">
            <span class="step-num">{{ i + 1 }}</span>
            <textarea v-model="step.content" class="field-textarea" rows="2" :placeholder="`Schritt ${i + 1}…`" />
            <button type="button" class="rm-btn" @click="removeStep(i)">×</button>
          </div>
          <button type="button" class="add-row-btn" @click="addStep">+ Schritt</button>
        </div>

        <button type="submit" class="save-btn" :disabled="isSaving">
          {{ isSaving ? 'Speichern…' : isEditMode ? 'Aktualisieren' : 'Gericht speichern' }}
        </button>
      </form>
    </section>

    <!-- WOCHENPLAN -->
    <section v-else-if="activeTab === 'plan'" class="tab-section">
      <header class="page-header header-row">
        <h1>Wochenplan</h1>
        <button class="cancel-edit-btn" @click="clearWholeWeek">Woche leeren</button>
      </header>
      <div class="week-grid">
        <div v-for="(dayName, dayIdx) in DAYS" :key="dayIdx" class="week-day">
          <div class="week-day-header">
            <span class="week-day-short">{{ DAYS_SHORT[dayIdx] }}</span>
            <span class="week-day-full">{{ dayName }}</span>
          </div>
          <div class="week-slots">
            <div
              v-for="s in SLOTS"
              :key="s.key"
              class="week-slot"
              :class="{ 'week-slot--filled': mealPlanMap.get(`${dayIdx}-${s.key}`) }"
            >
              <span class="week-slot-label">{{ s.label }}</span>
              <template v-if="mealPlanMap.get(`${dayIdx}-${s.key}`)">
                <button
                  class="week-slot-dish"
                  @click="() => { const d = dishes.find(d => d.id === mealPlanMap.get(`${dayIdx}-${s.key}`)!.dishId); if(d) openDetail(d) }"
                >
                  <img
                    v-if="mealPlanMap.get(`${dayIdx}-${s.key}`)!.imageUrl"
                    :src="mealPlanMap.get(`${dayIdx}-${s.key}`)!.imageUrl!"
                    class="week-dish-thumb"
                    alt=""
                  />
                  <span v-else class="week-dish-emoji">🍽️</span>
                  <span class="week-dish-name">{{ mealPlanMap.get(`${dayIdx}-${s.key}`)!.dishName }}</span>
                </button>
                <button class="week-slot-clear" @click="clearMealSlot(dayIdx, s.key)">×</button>
              </template>
              <button v-else class="week-slot-add" @click="openPicker(dayIdx, s.key)">
                <span>+</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- EINKAUFSLISTE -->
    <section v-else-if="activeTab === 'list'" class="tab-section">
      <header class="page-header header-row">
        <h1>Einkaufsliste</h1>
        <button
          v-if="shopping.some(s => s.isDone === 1)"
          class="cancel-edit-btn"
          @click="clearDoneItems"
        >Erledigt löschen</button>
      </header>
      <div class="shop-input-row">
        <input
          v-model="newItem"
          class="field-input"
          placeholder="Artikel hinzufügen…"
          @keydown.enter.prevent="addShoppingItem"
        />
        <button class="shop-add-btn" @click="addShoppingItem">+</button>
      </div>
      <div v-if="shopping.length === 0" class="empty-state">
        <p>Einkaufsliste ist leer.</p>
      </div>
      <TransitionGroup v-else name="list" tag="ul" class="shop-list">
        <li
          v-for="item in shopping"
          :key="item.id"
          class="shop-item"
          :class="{ 'shop-item--done': item.isDone === 1 }"
        >
          <button class="shop-check" @click="toggleShoppingItem(item)">
            <svg v-if="item.isDone === 1" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 10l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
          <span class="shop-title">{{ item.title }}</span>
          <button class="shop-delete" @click="deleteShoppingItem(item.id)">×</button>
        </li>
      </TransitionGroup>
    </section>
  </div>

  <!-- ── Detail Sheet ── -->
  <Transition name="sheet">
    <div v-if="detail" class="sheet-backdrop" @click.self="closeDetail">
      <article
        class="detail-sheet"
        :class="{
          'detail-sheet--expanded': sheetExpanded,
          'detail-sheet--dragging': swipeIsDragging,
        }"
        :style="swipeDragOffset !== 0 ? { transform: `translateY(calc(${sheetExpanded ? 0 : 'var(--sheet-peek-offset)'} + ${swipeDragOffset}px))` } : undefined"
        @touchstart.passive="onSheetTouchStart"
        @touchmove="onSheetTouchMove"
        @touchend="onSheetTouchEnd"
      >
        <!-- Hero image -->
        <div class="detail-hero">
          <img v-if="detail.imageUrl" :src="detail.imageUrl" :alt="detail.name" class="detail-hero-img" />
          <div v-else class="detail-hero-placeholder">🍽️</div>
          <button class="sheet-drag-handle" @click="toggleSheetExpanded" aria-label="Ausklappen">
            <span class="drag-bar" />
          </button>
          <div v-if="!sheetExpanded" class="swipe-hint">Nach oben wischen für das vollständige Rezept</div>
        </div>

        <!-- Scrollable body -->
        <div class="sheet-scroll" :class="{ 'sheet-scroll--open': sheetExpanded }">
          <!-- Name row + favorite -->
          <div class="detail-name-row">
            <h2 class="detail-title">{{ detail.name }}</h2>
            <button class="fav-btn" :class="{ 'fav-btn--active': isFavorited }" @click="toggleFavorite" :title="isFavorited ? 'Aus Favoriten entfernen' : 'Zu Favoriten'">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                  :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8"/>
              </svg>
            </button>
          </div>

          <p v-if="detail.description" class="detail-desc">{{ detail.description }}</p>

          <!-- Portion scaler -->
          <div class="portion-scaler">
            <span class="portion-scaler-label">Portionen</span>
            <div class="portion-stepper">
              <button type="button" class="portion-btn" :disabled="viewPortions <= 1" @click="viewPortions = Math.max(1, viewPortions - 1)">−</button>
              <span class="portion-count">{{ viewPortions }}</span>
              <button type="button" class="portion-btn" @click="viewPortions += 1">+</button>
            </div>
            <span v-if="viewPortions !== detail.portions" class="portion-base-hint">(Grundrezept: {{ detail.portions }})</span>
          </div>

          <!-- Zutaten -->
          <div v-if="detail.ingredients.length" class="detail-block">
            <div class="detail-block-header">
              <h3>Zutaten</h3>
              <button class="add-all-btn" @click="addAllIngredientsToShop">
                <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                Alle zur Liste
              </button>
            </div>
            <ul class="ingredient-list">
              <li v-for="(ing, i) in detail.ingredients" :key="i" class="ingredient-item">
                <span class="ing-amount-badge">{{ scaleAmount(ing.amount, scaleFactor) }}</span>
                <span class="ing-name-text">{{ ing.name }}</span>
                <button class="ing-add-btn" @click="addIngredientToShop(ing)" title="Zur Einkaufsliste">
                  <svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </button>
              </li>
            </ul>
          </div>

          <!-- Schritte -->
          <div v-if="detail.steps.length" class="detail-block">
            <h3>Zubereitung</h3>
            <ol class="steps-list">
              <li v-for="step in detail.steps" :key="step.stepIndex" class="step-item">
                <span class="step-index">{{ step.stepIndex }}</span>
                <p class="step-content">{{ step.content }}</p>
              </li>
            </ol>
          </div>

          <!-- Aktionen -->
          <div class="detail-actions">
            <button class="detail-action-btn detail-action-btn--edit" @click="openEditFromDetail">
              ✏️ Bearbeiten
            </button>
            <button class="detail-action-btn detail-action-btn--delete" @click="deleteConfirm = true">
              🗑️ Löschen
            </button>
          </div>

          <!-- Löschen bestätigen -->
          <Transition name="fade">
            <div v-if="deleteConfirm" class="delete-confirm">
              <p>Gericht wirklich löschen?</p>
              <div class="delete-confirm-btns">
                <button class="dc-cancel" @click="deleteConfirm = false">Abbrechen</button>
                <button class="dc-confirm" :disabled="isDeleting" @click="deleteDish">
                  {{ isDeleting ? 'Löschen…' : 'Ja, löschen' }}
                </button>
              </div>
            </div>
          </Transition>

          <div style="height: 2rem" />
        </div>
      </article>
    </div>
  </Transition>

  <!-- ── Dish Picker (Wochenplan) ── -->
  <Transition name="sheet">
    <div v-if="pickingSlot" class="sheet-backdrop" @click.self="pickingSlot = null">
      <article class="detail-sheet detail-sheet--expanded picker-sheet">
        <div class="detail-hero picker-hero">
          <button class="sheet-drag-handle" @click="pickingSlot = null" aria-label="Schließen">
            <span class="drag-bar" />
          </button>
          <h2 class="picker-title">Rezept auswählen</h2>
        </div>
        <div class="sheet-scroll sheet-scroll--open">
          <div v-if="dishes.length === 0" class="empty-state"><p>Keine Rezepte vorhanden.</p></div>
          <div v-else class="picker-list">
            <button
              v-for="dish in dishes"
              :key="dish.id"
              class="picker-item"
              @click="assignDish(dish.id)"
            >
              <div class="picker-thumb">
                <img v-if="dish.imageUrl" :src="dish.imageUrl" :alt="dish.name" />
                <span v-else>🍽️</span>
              </div>
              <div class="picker-info">
                <span class="picker-name">{{ dish.name }}</span>
                <span v-if="dish.description" class="picker-desc">{{ dish.description }}</span>
              </div>
            </button>
          </div>
        </div>
      </article>
    </div>
  </Transition>

  <!-- ── Bottom Navigation ── -->
  <nav class="bottom-nav">
    <!-- Favoriten -->
    <button
      class="nav-btn"
      :class="{ 'nav-btn--active': activeTab === 'fav' }"
      @click="activeTab = 'fav'"
      aria-label="Favoriten"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          :fill="activeTab === 'fav' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8"/>
      </svg>
      <span>Favoriten</span>
    </button>

    <!-- Hinzufügen -->
    <button
      class="nav-btn"
      :class="{ 'nav-btn--active': activeTab === 'add' }"
      @click="activeTab = 'add'"
      aria-label="Hinzufügen"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>Hinzufügen</span>
    </button>

    <!-- Home (center raised) -->
    <button
      class="nav-btn nav-btn--home"
      :class="{ 'nav-btn--home-active': activeTab === 'home' }"
      @click="activeTab = 'home'"
      aria-label="Rezepte"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M3 12L12 4l9 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- Wochenplan -->
    <button
      class="nav-btn"
      :class="{ 'nav-btn--active': activeTab === 'plan' }"
      @click="activeTab = 'plan'"
      aria-label="Wochenplan"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" stroke-width="1.8"/>
        <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span>Wochenplan</span>
    </button>

    <!-- Einkauf -->
    <button
      class="nav-btn"
      :class="{ 'nav-btn--active': activeTab === 'list' }"
      @click="activeTab = 'list'"
      aria-label="Einkaufsliste"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M3 6h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16 10a4 4 0 01-8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span v-if="pendingCount > 0" class="nav-badge">{{ pendingCount }}</span>
      <span>Einkauf</span>
    </button>
  </nav>
</template>
