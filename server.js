const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const cors = require("cors")
const jwt = require("jsonwebtoken")
const bcrypt = require("bcryptjs")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: [process.env.FRONTEND_URL || "http://localhost:3000", "http://localhost:3000", "https://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
})

// Middleware
app.use(
  cors({
    origin: [process.env.FRONTEND_URL || "http://localhost:3000", "http://localhost:3000", "https://localhost:3000"],
    credentials: true,
  }),
)
app.use(express.json())

// Add this after the existing middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// Mock databases
const users = [
  {
    _id: "1",
    name: "John Doe",
    email: "john@example.com",
    password: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukx.LrUpm", // secret123
    createdAt: new Date().toISOString(),
  },
  {
    _id: "2",
    name: "Jane Smith",
    email: "jane@example.com",
    password: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukx.LrUpm", // secret123
    createdAt: new Date().toISOString(),
  },
  {
    _id: "3",
    name: "Bob Johnson",
    email: "bob@example.com",
    password: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6ukx.LrUpm", // secret123
    createdAt: new Date().toISOString(),
  },
  {
    _id: "4",
    name: "sample",
    email: "sample@gmail.com",
    password: "12345", // 12345
    createdAt: new Date().toISOString(),
  },
]

const tasks = []
let activities = []

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"]
  const token = authHeader && authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ message: "Access token required" })
  }

  jwt.verify(token, process.env.JWT_SECRET || "fallback-secret", (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid token" })
    }
    req.user = user
    next()
  })
}

// Socket authentication
const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth.token

  if (!token) {
    return next(new Error("Authentication error"))
  }

  jwt.verify(token, process.env.JWT_SECRET || "fallback-secret", (err, decoded) => {
    if (err) {
      return next(new Error("Authentication error"))
    }
    socket.userId = decoded.userId
    next()
  })
}

// Socket.IO connection handling
io.use(authenticateSocket)

io.on("connection", (socket) => {
  console.log("User connected:", socket.userId)

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.userId)
  })
})

// Helper function to broadcast task updates
const broadcastTaskUpdate = (action, task, user) => {
  io.emit(action, task)

  // Add to activity log
  const activity = {
    _id: Date.now().toString(),
    action: `${action.replace("task", "").trim()} task "${task.title}"`,
    user,
    task,
    timestamp: new Date().toISOString(),
  }
  activities.unshift(activity)
  activities = activities.slice(0, 20)

  io.emit("activityAdded", activity)
}

// Auth routes
app.post("/api/auth/register", async (req, res) => {
  try {
    console.log("Registration attempt:", req.body.email)
    const { name, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" })
    }

    const existingUser = users.find((user) => user.email === email)
    if (existingUser) {
      console.log("User already exists:", email)
      return res.status(400).json({ message: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const user = {
      _id: Date.now().toString(),
      name,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
    }

    users.push(user)
    console.log("User registered successfully:", email)
    console.log("Total users:", users.length)

    const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET || "fallback-secret", {
      expiresIn: "7d",
    })

    const { password: _, ...userWithoutPassword } = user
    res.status(201).json({ message: "User created successfully", token, user: userWithoutPassword })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" })
    }

    const user = users.find((user) => user.email === email)
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET || "fallback-secret", {
      expiresIn: "7d",
    })

    const { password: _, ...userWithoutPassword } = user
    res.json({ message: "Login successful", token, user: userWithoutPassword })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

// Task routes
app.get("/api/tasks", authenticateToken, (req, res) => {
  res.json(tasks)
})

app.post("/api/tasks", authenticateToken, (req, res) => {
  try {
    const { title, description, status, priority, assignedTo } = req.body

    if (!title || !assignedTo) {
      return res.status(400).json({ message: "Title and assigned user are required" })
    }

    // Check for duplicate title
    const existingTask = tasks.find((task) => task.title.toLowerCase() === title.toLowerCase())
    if (existingTask) {
      return res.status(400).json({ message: "Task title must be unique" })
    }

    // Check if title matches column names
    const columnNames = ["todo", "in progress", "done"]
    if (columnNames.includes(title.toLowerCase())) {
      return res.status(400).json({ message: "Task title cannot match column names" })
    }

    const assignedUser = users.find((u) => u._id === assignedTo)
    const createdByUser = users.find((u) => u._id === req.user.userId)

    if (!assignedUser || !createdByUser) {
      return res.status(400).json({ message: "Invalid user" })
    }

    const task = {
      _id: Date.now().toString(),
      title,
      description: description || "",
      status: status || "Todo",
      priority: priority || "Medium",
      assignedTo: assignedUser,
      createdBy: createdByUser,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    tasks.push(task)
    broadcastTaskUpdate("taskCreated", task, createdByUser)

    res.status(201).json(task)
  } catch (error) {
    console.error("Create task error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

app.put("/api/tasks/:id", authenticateToken, (req, res) => {
  try {
    const { title, description, status, priority, assignedTo } = req.body
    const taskId = req.params.id

    const taskIndex = tasks.findIndex((task) => task._id === taskId)
    if (taskIndex === -1) {
      return res.status(404).json({ message: "Task not found" })
    }

    const existingTask = tasks[taskIndex]
    const currentUser = users.find((u) => u._id === req.user.userId)

    // Simple conflict detection
    const lastModified = new Date(existingTask.updatedAt)
    const now = new Date()
    const timeDiff = now.getTime() - lastModified.getTime()

    if (timeDiff < 5000 && existingTask.lastModifiedBy && existingTask.lastModifiedBy !== req.user.userId) {
      return res.status(409).json({
        message: "Conflict detected",
        conflict: true,
        currentVersion: existingTask,
        conflictFields: ["title", "description", "status", "priority"],
      })
    }

    // Validate title uniqueness
    if (title && title !== existingTask.title) {
      const duplicateTask = tasks.find(
        (task) => task._id !== taskId && task.title.toLowerCase() === title.toLowerCase(),
      )
      if (duplicateTask) {
        return res.status(400).json({ message: "Task title must be unique" })
      }
    }

    let assignedUser = existingTask.assignedTo
    if (assignedTo && assignedTo !== existingTask.assignedTo._id) {
      assignedUser = users.find((u) => u._id === assignedTo)
      if (!assignedUser) {
        return res.status(400).json({ message: "Invalid assigned user" })
      }
    }

    const updatedTask = {
      ...existingTask,
      title: title || existingTask.title,
      description: description !== undefined ? description : existingTask.description,
      status: status || existingTask.status,
      priority: priority || existingTask.priority,
      assignedTo: assignedUser,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: req.user.userId,
    }

    tasks[taskIndex] = updatedTask
    broadcastTaskUpdate("taskUpdated", updatedTask, currentUser)

    res.json(updatedTask)
  } catch (error) {
    console.error("Update task error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

app.delete("/api/tasks/:id", authenticateToken, (req, res) => {
  try {
    const taskId = req.params.id
    const taskIndex = tasks.findIndex((task) => task._id === taskId)

    if (taskIndex === -1) {
      return res.status(404).json({ message: "Task not found" })
    }

    const deletedTask = tasks[taskIndex]
    const currentUser = users.find((u) => u._id === req.user.userId)

    tasks.splice(taskIndex, 1)
    broadcastTaskUpdate("taskDeleted", { _id: taskId }, currentUser)

    res.json({ message: "Task deleted successfully" })
  } catch (error) {
    console.error("Delete task error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

app.put("/api/tasks/:id/smart-assign", authenticateToken, (req, res) => {
  try {
    const taskId = req.params.id
    const taskIndex = tasks.findIndex((task) => task._id === taskId)

    if (taskIndex === -1) {
      return res.status(404).json({ message: "Task not found" })
    }

    // Smart assign logic
    const userTaskCounts = users.map((user) => ({
      user,
      activeTasks: tasks.filter((task) => task.assignedTo._id === user._id && task.status !== "Done").length,
    }))

    userTaskCounts.sort((a, b) => a.activeTasks - b.activeTasks)
    const userWithFewestTasks = userTaskCounts[0].user
    const currentUser = users.find((u) => u._id === req.user.userId)

    const updatedTask = {
      ...tasks[taskIndex],
      assignedTo: userWithFewestTasks,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: req.user.userId,
    }

    tasks[taskIndex] = updatedTask
    broadcastTaskUpdate("taskUpdated", updatedTask, currentUser)

    res.json(updatedTask)
  } catch (error) {
    console.error("Smart assign error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
})

// User routes
app.get("/api/users", authenticateToken, (req, res) => {
  const usersWithoutPasswords = users.map(({ password, ...user }) => user)
  res.json(usersWithoutPasswords)
})

// Activity routes
app.get("/api/activities", authenticateToken, (req, res) => {
  res.json(activities.slice(0, 20))
})

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
// Example using Express
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // TODO: Add logic to check if user exists and save to DB
    console.log("New user:", { username, email });

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
