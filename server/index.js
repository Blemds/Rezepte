import cors from 'cors'
import express from 'express'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { initializeDatabase, query, withTransaction } from './db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadsDir = path.join(__dirname, 'uploads')

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname)
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

const upload = multer({ storage })
const app = express()
const port = Number(process.env.API_PORT ?? 3001)
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`

app.use(cors())
app.use(express.json({ limit: '3mb' }))
app.use('/uploads', express.static(uploadsDir))

/* ── helpers ── */
function dishUrl(row) {
  return row.imagePath ? `${publicBaseUrl}/${row.imagePath}` : null
}

/* ── health ── */
app.get('/api/health', async (_req, res) => {
  try {
    await query('SELECT 1')
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, message: 'DB Verbindung fehlgeschlagen.' })
  }
})

/* ── dishes ── */
app.get('/api/dishes', async (_req, res) => {
  const rows = await query(
    `SELECT id, name, description, image_path AS imagePath, portions, created_at AS createdAt
     FROM dishes ORDER BY created_at DESC`,
  )
  res.json(rows.map((r) => ({ ...r, imageUrl: dishUrl(r) })))
})

app.get('/api/dishes/:id', async (req, res) => {
  const dishId = Number(req.params.id)
  if (Number.isNaN(dishId)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }

  const rows = await query(
    `SELECT id, name, description, image_path AS imagePath, portions, created_at AS createdAt
     FROM dishes WHERE id = ?`, [dishId],
  )
  const dish = rows[0]
  if (!dish) { res.status(404).json({ message: 'Gericht nicht gefunden.' }); return }

  const ingredients = await query(
    `SELECT id, name, amount FROM ingredients WHERE dish_id = ? ORDER BY id ASC`, [dishId],
  )
  const steps = await query(
    `SELECT id, step_index AS stepIndex, content FROM recipe_steps WHERE dish_id = ? ORDER BY step_index ASC`, [dishId],
  )

  res.json({ ...dish, imageUrl: dishUrl(dish), ingredients, steps })
})

app.post('/api/dishes', upload.single('image'), async (req, res) => {
  const { name, description, portions } = req.body
  if (!name || !String(name).trim()) { res.status(400).json({ message: 'Name ist erforderlich.' }); return }
  const imagePath = req.file ? `uploads/${req.file.filename}` : null
  const p = Math.max(1, Number(portions ?? 1) || 1)
  const result = await query(
    `INSERT INTO dishes (name, description, image_path, portions) VALUES (?, ?, ?, ?)`,
    [String(name).trim(), String(description ?? '').trim(), imagePath, p],
  )
  res.status(201).json({ id: result.insertId })
})

app.put('/api/dishes/:id', upload.single('image'), async (req, res) => {
  const dishId = Number(req.params.id)
  const { name, description, keepExistingImage, portions } = req.body
  if (Number.isNaN(dishId)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }
  if (!name || !String(name).trim()) { res.status(400).json({ message: 'Name ist erforderlich.' }); return }

  const existingRows = await query('SELECT image_path AS imagePath FROM dishes WHERE id = ?', [dishId])
  const existingDish = existingRows[0]
  if (!existingDish) { res.status(404).json({ message: 'Gericht nicht gefunden.' }); return }

  let imagePath = existingDish.imagePath ?? null
  if (req.file) imagePath = `uploads/${req.file.filename}`
  else if (String(keepExistingImage) === 'false') imagePath = null

  const p = Math.max(1, Number(portions ?? 1) || 1)
  await query(
    `UPDATE dishes SET name = ?, description = ?, image_path = ?, portions = ? WHERE id = ?`,
    [String(name).trim(), String(description ?? '').trim(), imagePath, p, dishId],
  )
  res.json({ ok: true })
})

app.delete('/api/dishes/:id', async (req, res) => {
  const dishId = Number(req.params.id)
  if (Number.isNaN(dishId)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }
  await query('DELETE FROM dishes WHERE id = ?', [dishId])
  res.json({ ok: true })
})

app.put('/api/dishes/:id/details', async (req, res) => {
  const dishId = Number(req.params.id)
  if (Number.isNaN(dishId)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }

  const ingredients = Array.isArray(req.body.ingredients) ? req.body.ingredients : []
  const steps = Array.isArray(req.body.steps) ? req.body.steps : []

  await withTransaction(async (connection) => {
    const [dishRows] = await connection.execute('SELECT id FROM dishes WHERE id = ?', [dishId])
    if (!dishRows[0]) {
      const error = new Error('Gericht nicht gefunden.')
      error.statusCode = 404
      throw error
    }
    await connection.execute('DELETE FROM ingredients WHERE dish_id = ?', [dishId])
    for (const ingredient of ingredients) {
      const n = String(ingredient.name ?? '').trim()
      if (!n) continue
      await connection.execute('INSERT INTO ingredients (dish_id, name, amount) VALUES (?, ?, ?)',
        [dishId, n, String(ingredient.amount ?? '').trim()])
    }
    await connection.execute('DELETE FROM recipe_steps WHERE dish_id = ?', [dishId])
    for (let i = 0; i < steps.length; i++) {
      const c = String(steps[i].content ?? '').trim()
      if (!c) continue
      await connection.execute('INSERT INTO recipe_steps (dish_id, step_index, content) VALUES (?, ?, ?)',
        [dishId, i + 1, c])
    }
  })
  res.json({ ok: true })
})

/* ── shopping items ── */
app.get('/api/shopping-items', async (_req, res) => {
  const rows = await query(`SELECT id, title, is_done AS isDone, created_at AS createdAt
     FROM shopping_items ORDER BY is_done ASC, created_at DESC`)
  res.json(rows)
})

app.post('/api/shopping-items', async (req, res) => {
  const title = String(req.body.title ?? '').trim()
  if (!title) { res.status(400).json({ message: 'Titel ist erforderlich.' }); return }
  const result = await query('INSERT INTO shopping_items (title, is_done) VALUES (?, 0)', [title])
  res.status(201).json({ id: result.insertId })
})

app.put('/api/shopping-items/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }
  await query('UPDATE shopping_items SET is_done = ? WHERE id = ?', [req.body.isDone ? 1 : 0, id])
  res.json({ ok: true })
})

app.delete('/api/shopping-items/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) { res.status(400).json({ message: 'Ungueltige ID.' }); return }
  await query('DELETE FROM shopping_items WHERE id = ?', [id])
  res.json({ ok: true })
})

/* ── meal plan ── */
app.get('/api/meal-plan', async (_req, res) => {
  const rows = await query(`
    SELECT mp.id, mp.day_of_week AS \`day\`, mp.meal_slot AS slot,
           mp.dish_id AS dishId, d.name AS dishName, d.image_path AS imagePath
    FROM meal_plan mp LEFT JOIN dishes d ON mp.dish_id = d.id
    ORDER BY mp.day_of_week, mp.meal_slot`)
  res.json(rows.map((r) => ({ ...r, imageUrl: r.imagePath ? `${publicBaseUrl}/${r.imagePath}` : null })))
})

app.put('/api/meal-plan', async (req, res) => {
  const { day, slot, dishId } = req.body
  if (dishId === null || dishId === undefined) {
    await query('DELETE FROM meal_plan WHERE day_of_week = ? AND meal_slot = ?', [day, slot])
  } else {
    await query(
      `INSERT INTO meal_plan (day_of_week, meal_slot, dish_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE dish_id = VALUES(dish_id)`,
      [day, slot, dishId],
    )
  }
  res.json({ ok: true })
})

/* ── favorites ── */
app.get('/api/favorites', async (_req, res) => {
  const rows = await query(`
    SELECT d.id, d.name, d.description, d.image_path AS imagePath, d.portions
    FROM favorites f JOIN dishes d ON f.dish_id = d.id
    ORDER BY f.created_at DESC`)
  res.json(rows.map((r) => ({ ...r, imageUrl: dishUrl(r) })))
})

app.post('/api/favorites/:dishId', async (req, res) => {
  const id = Number(req.params.dishId)
  try { await query('INSERT INTO favorites (dish_id) VALUES (?)', [id]) } catch {}
  res.json({ ok: true })
})

app.delete('/api/favorites/:dishId', async (req, res) => {
  await query('DELETE FROM favorites WHERE dish_id = ?', [Number(req.params.dishId)])
  res.json({ ok: true })
})

/* ── error handler ── */
app.use((error, _req, res, _next) => {
  res.status(error.statusCode ?? 500).json({ message: error.message ?? 'Unbekannter Serverfehler.' })
})

/* ── start ── */
async function startServer() {
  await initializeDatabase()
  // Migration: add portions column to existing installs
  try { await query('ALTER TABLE dishes ADD COLUMN portions INT NOT NULL DEFAULT 1') } catch {}
  app.listen(port, () => console.log(`API laeuft auf http://localhost:${port}`))
}

startServer().catch((error) => {
  console.error('API konnte nicht gestartet werden:', error.message)
  process.exit(1)
})
