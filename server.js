const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// Пути к папкам
const distPath = path.join(__dirname, 'client', 'dist');
const uploadDir = path.join(__dirname, 'uploads');

// Создаем папку для загрузок, если её нет
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Раздача статики
app.use(express.static(distPath));
app.use('/uploads', express.static(uploadDir));

// Настройка Multer (загрузка файлов)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Инициализация базы данных
const db = new sqlite3.Database('./chat.db');

db.serialize(() => {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT,
        display_name TEXT,
        status TEXT DEFAULT 'Пользуюсь мессенджером',
        avatar_url TEXT
    )`);

    // Таблица истории аватарок
    db.run(`CREATE TABLE IF NOT EXISTS avatar_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        url TEXT,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица сообщений
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        sender TEXT, 
        receiver TEXT, 
        text TEXT, 
        type TEXT DEFAULT 'text', 
        fileUrl TEXT,
        replyToId INTEGER,
        groupId INTEGER,
        status TEXT DEFAULT 'sent',
        read_status INTEGER DEFAULT 0,
        time DATETIME DEFAULT CURRENT_TIMESTAMP 
    )`);

    // НОВАЯ ТАБЛИЦА: Реакции
    db.run(`CREATE TABLE IF NOT EXISTS reactions (
        messageId INTEGER,
        username TEXT,
        emoji TEXT,
        PRIMARY KEY(messageId, username)
    )`);

    // Таблица групп
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        creator TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица участников групп
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        groupId INTEGER,
        username TEXT,
        role TEXT DEFAULT 'member',
        PRIMARY KEY(groupId, username)
    )`);
});

// --- АВТОРИЗАЦИЯ ---

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hash = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], function(err) {
            if (err) return res.status(400).json({ error: "Логин уже занят" });
            res.json({ success: true });
        });
    } catch (e) { res.status(500).json({ error: "Ошибка регистрации" }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Неверный логин или пароль" });
        }
        res.json({ success: true, username: user.username });
    });
});

// --- ПРОФИЛИ ---

app.get('/api/profile/:username', (req, res) => {
    const { username } = req.params;
    db.get("SELECT username, display_name, status, avatar_url FROM users WHERE username = ?", [username], (err, user) => {
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        
        db.all("SELECT url FROM avatar_history WHERE username = ? ORDER BY id DESC", [username], (err, avatars) => {
            res.json({ ...user, avatar_history: avatars || [] });
        });
    });
});

app.post('/api/profile/update', (req, res) => {
    const { username, display_name, status, avatar_url } = req.body;
    db.run("UPDATE users SET display_name = ?, status = ?, avatar_url = ? WHERE username = ?", 
        [display_name, status, avatar_url, username], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (avatar_url) {
                db.run("INSERT INTO avatar_history (username, url) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM avatar_history WHERE username = ? AND url = ?)", 
                [username, avatar_url, username, avatar_url]);
            }
            res.json({ success: true });
    });
});

// --- ЧАТ И СООБЩЕНИЯ ---

app.get('/api/users/search', (req, res) => {
    db.all("SELECT username, display_name, avatar_url FROM users WHERE username LIKE ? LIMIT 10", [`%${req.query.query}%`], (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/dialogs', (req, res) => {
    const { user } = req.query;
    const sql = `
        SELECT DISTINCT 
            u.username as contact, 
            u.display_name, 
            u.avatar_url,
            (SELECT text FROM messages 
             WHERE (sender = u.username AND receiver = ?) OR (receiver = u.username AND sender = ?) 
             ORDER BY id DESC LIMIT 1) as last_message,
            (SELECT time FROM messages 
             WHERE (sender = u.username AND receiver = ?) OR (receiver = u.username AND sender = ?) 
             ORDER BY id DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM messages 
             WHERE sender = u.username AND receiver = ? AND status = 'sent') as unread_count
        FROM (
            SELECT sender as name FROM messages WHERE receiver = ?
            UNION
            SELECT receiver as name FROM messages WHERE sender = ?
        ) AS contacts
        JOIN users u ON u.username = contacts.name
    `;
    db.all(sql, [user, user, user, user, user, user, user], (err, rows) => {
        if (err) {
            console.error('SQL Error:', err);
            return res.status(500).json([]);
        }
        // Добавляем форматирование времени
        const processed = rows.map(row => ({
            ...row,
            last_time: row.last_time ? new Date(row.last_time).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}) : null
        }));
        res.json(processed || []);
    });
});

// ОБНОВЛЕНО: Получение сообщений с реакциями
app.get('/api/get-messages', (req, res) => {
    const { me, withUser } = req.query;
    const sql = `
        SELECT m1.*, strftime('%H:%M', m1.time, 'localtime') as time,
               m2.sender as replyUser, m2.text as replyText,
               (SELECT GROUP_CONCAT(emoji || ':' || username) FROM reactions WHERE messageId = m1.id) as reactionData
        FROM messages m1
        LEFT JOIN messages m2 ON m1.replyToId = m2.id
        WHERE (m1.sender = ? AND m1.receiver = ?) OR (m1.sender = ? AND m1.receiver = ?)
        ORDER BY m1.id ASC
    `;
    db.all(sql, [me, withUser, withUser, me], (err, rows) => {
        if (err) return res.status(500).json([]);
        
        // Преобразуем строку "emoji:user,emoji:user" в массив объектов
        const processedRows = rows.map(row => {
            const reactions = [];
            if (row.reactionData) {
                row.reactionData.split(',').forEach(rd => {
                    const [emoji, user] = rd.split(':');
                    reactions.push({ emoji, user });
                });
            }
            return { ...row, reactions };
        });
        res.json(processedRows);
    });
});

app.post('/api/send-message', (req, res) => {
    const { sender, receiver, text, type, fileUrl, replyToId } = req.body;
    db.run("INSERT INTO messages (sender, receiver, text, type, fileUrl, replyToId) VALUES (?, ?, ?, ?, ?, ?)", 
        [sender, receiver, text, type || 'text', fileUrl || null, replyToId || null], () => res.json({ success: true }));
});

app.post('/api/edit-message/:id', (req, res) => {
    const { text, sender } = req.body;
    db.run("UPDATE messages SET text = ? WHERE id = ? AND sender = ?", [text, req.params.id, sender], function(err) {
        if (this.changes === 0) return res.status(403).json({ error: "Ошибка доступа" });
        res.json({ success: true });
    });
});

app.delete('/api/delete-message/:id', (req, res) => {
    db.run("DELETE FROM messages WHERE id = ?", req.params.id, () => {
        // Удаляем и реакции к этому сообщению
        db.run("DELETE FROM reactions WHERE messageId = ?", req.params.id);
        res.json({ success: true });
    });
});

// --- НОВЫЙ API: ПОСТАВИТЬ РЕАКЦИЮ ---
app.post('/api/react', (req, res) => {
    const { messageId, username, emoji } = req.body;
    
    db.get("SELECT emoji FROM reactions WHERE messageId = ? AND username = ?", [messageId, username], (err, row) => {
        if (row) {
            if (row.emoji === emoji) {
                // Убираем реакцию, если нажали на ту же
                db.run("DELETE FROM reactions WHERE messageId = ? AND username = ?", [messageId, username], () => res.json({ success: true }));
            } else {
                // Меняем реакцию
                db.run("UPDATE reactions SET emoji = ? WHERE messageId = ? AND username = ?", [emoji, messageId, username], () => res.json({ success: true }));
            }
        } else {
            // Ставим новую
            db.run("INSERT INTO reactions (messageId, username, emoji) VALUES (?, ?, ?)", [messageId, username, emoji], () => res.json({ success: true }));
        }
    });
});

// API: Обновить статус сообщения (доставлено/прочитано)
app.post('/api/message-status', (req, res) => {
    const { messageId, status } = req.body;
    db.run("UPDATE messages SET status = ? WHERE id = ?", [status, messageId], () => res.json({ success: true }));
});

// API: Получить непрочитанные сообщения и пометить их как прочитанные
app.get('/api/mark-read', (req, res) => {
    const { user, fromUser } = req.query;
    db.run("UPDATE messages SET status = 'read', read_status = 1 WHERE sender = ? AND receiver = ? AND read_status = 0", 
        [fromUser, user], () => {
            db.all("SELECT id FROM messages WHERE sender = ? AND receiver = ? AND read_status = 0", 
                [fromUser, user], (err, rows) => res.json({ updated: rows?.length || 0 }));
        });
});

// --- ФАЙЛЫ ---

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    const isImg = req.file.mimetype.startsWith('image/');
    res.json({ 
        url: `/uploads/${req.file.filename}`, 
        name: req.file.originalname, 
        type: isImg ? 'image' : 'file' 
    });
});

// --- РОУТИНГ ДЛЯ REACT ---
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
});

// API: Поиск по сообщениям
app.get('/api/search-messages', (req, res) => {
    const { user, query } = req.query;
    if (!query || query.length < 2) return res.json([]);
    
    const sql = `
        SELECT m.*, u.display_name as partnerName, u.avatar_url as partnerAvatar
        FROM messages m
        JOIN users u ON (m.sender = u.username OR m.receiver = u.username)
        WHERE (m.sender = ? OR m.receiver = ?) AND m.text LIKE ?
        ORDER BY m.id DESC
        LIMIT 50
    `;
    db.all(sql, [user, user, `%${query}%`], (err, rows) => {
        res.json(rows || []);
    });
});

// API: Создать группу
app.post('/api/groups/create', (req, res) => {
    const { name, creator, members } = req.body;
    db.run("INSERT INTO groups (name, creator) VALUES (?, ?)", [name, creator], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const groupId = this.lastID;
        // Добавляем создателя и участников
        db.run("INSERT INTO group_members (groupId, username, role) VALUES (?, ?, 'admin')", [groupId, creator]);
        if (members && members.length > 0) {
            members.forEach(m => db.run("INSERT INTO group_members (groupId, username) VALUES (?, ?)", [groupId, m]));
        }
        res.json({ success: true, groupId });
    });
});

// API: Получить группы пользователя
app.get('/api/groups', (req, res) => {
    const { user } = req.query;
    const sql = `
        SELECT g.*, gm.role,
            (SELECT COUNT(*) FROM group_members WHERE groupId = g.id) as memberCount
        FROM groups g
        JOIN group_members gm ON g.id = gm.groupId
        WHERE gm.username = ?
        ORDER BY g.created_at DESC
    `;
    db.all(sql, [user], (err, rows) => res.json(rows || []));
});

// API: Получить сообщения группы
app.get('/api/group-messages', (req, res) => {
    const { groupId } = req.query;
    const sql = `
        SELECT m.*, u.display_name as senderName, u.avatar_url as senderAvatar
        FROM messages m
        JOIN users u ON m.sender = u.username
        WHERE m.groupId = ?
        ORDER BY m.id ASC
    `;
    db.all(sql, [groupId], (err, rows) => res.json(rows || []));
});

// API: Отправить сообщение в группу
app.post('/api/group-message', (req, res) => {
    const { groupId, sender, text, type, fileUrl } = req.body;
    db.run("INSERT INTO messages (sender, text, type, fileUrl, groupId) VALUES (?, ?, ?, ?, ?)", 
        [sender, text, type || 'text', fileUrl || null, groupId], 
        () => res.json({ success: true }));
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер готов: http://localhost:${PORT}`);
});