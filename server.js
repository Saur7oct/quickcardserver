const express = require("express");

const jwt = require('jsonwebtoken');

const bcrypt = require('bcryptjs');

const mysql = require('mysql2/promise');

const multer = require("multer");

const cors = require("cors");

const path = require('path');

const fs = require('fs');

const xlsx = require('xlsx');



const app = express();



// Configuration

const JWT_SECRET = 'your_jwt_secret_key_should_be_long_and_complex';

const PORT = process.env.PORT || 10000;



// TiDB Cloud Configuration

const masterPool = mysql.createPool({

    host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',

    port: 4000,

    user: '31vfRZdqNp1MYPb.root',

    password: 'ejFDuNHi3zrvkGM9',

    database: 'test',

    waitForConnections: true,

    connectionLimit: 10,

    queueLimit: 0,

    enableKeepAlive: true,

    keepAliveInitialDelay: 0,

    ssl: {

        rejectUnauthorized: false

    }

});



// Database name cache for user databases (store names only to prevent stale connection errors)

const dbNameCache = new Map();



// Middleware

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));



// Health check endpoint

app.get('/health', (req, res) => {

    res.status(200).json({ 

        status: 'ok', 

        message: 'Server is running',

        timestamp: new Date().toISOString()

    });

});



// Root endpoint

app.get('/', (req, res) => {

    res.json({ 

        message: 'Student Management API',

        endpoints: ['/health', '/login', '/register', '/api/students', '/api/teachers'],

        status: 'running',

        version: '1.0.0'

    });

});



// Multer configuration for file uploads

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        const uploadDir = path.join(__dirname, 'temp_uploads');

        if (!fs.existsSync(uploadDir)) {

            fs.mkdirSync(uploadDir, { recursive: true });

        }

        cb(null, uploadDir);

    },

    filename: function (req, file, cb) {

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);

        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));

    }

});



const upload = multer({ 

    storage,

    limits: { fileSize: 10 * 1024 * 1024 },

    fileFilter: (req, file, cb) => {

        if (file.mimetype.startsWith('image/')) {

            cb(null, true);

        } else {

            cb(new Error('Only image files are allowed!'), false);

        }

    }

});



const documentUpload = multer({ 

    storage,

    limits: { fileSize: 10 * 1024 * 1024 },

    fileFilter: (req, file, cb) => {

        const allowedMimes = [

            'application/vnd.ms-excel', 

            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

            'text/csv'

        ];

        

        if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/)) {

            cb(null, true);

        } else {

            cb(new Error('Only Excel and CSV files are allowed!'), false);

        }

    }

});



// Function to add missing columns to existing tables

async function migrateDatabase(connection, dbName) {

    try {

        // Check if dateofbirth column exists in studentdetails table

        const [columns] = await connection.query(`

            SELECT COLUMN_NAME 

            FROM INFORMATION_SCHEMA.COLUMNS 

            WHERE TABLE_SCHEMA = ? 

            AND TABLE_NAME = 'studentdetails' 

            AND COLUMN_NAME = 'dateofbirth'

        `, [dbName]);

        

        if (columns.length === 0) {

            console.log(`Adding dateofbirth column to studentdetails table in database: ${dbName}`);

            await connection.query(`

                ALTER TABLE studentdetails 

                ADD COLUMN dateofbirth VARCHAR(50) NULL

            `);

            console.log(`✅ dateofbirth column added successfully to ${dbName}`);

        }

        

        // Check if student_house column exists in studentdetails table

        const [houseColumns] = await connection.query(`

            SELECT COLUMN_NAME 

            FROM INFORMATION_SCHEMA.COLUMNS 

            WHERE TABLE_SCHEMA = ? 

            AND TABLE_NAME = 'studentdetails' 

            AND COLUMN_NAME = 'student_house'

        `, [dbName]);

        

        if (houseColumns.length === 0) {

            console.log(`Adding student_house column to studentdetails table in database: ${dbName}`);

            await connection.query(`

                ALTER TABLE studentdetails 

                ADD COLUMN student_house VARCHAR(100) NULL

            `);

            console.log(`✅ student_house column added successfully to ${dbName}`);

        }

        

        // Also add index on dateofbirth for better performance

        const [indexes] = await connection.query(`

            SELECT INDEX_NAME 

            FROM INFORMATION_SCHEMA.STATISTICS 

            WHERE TABLE_SCHEMA = ? 

            AND TABLE_NAME = 'studentdetails' 

            AND INDEX_NAME = 'idx_dateofbirth'

        `, [dbName]);

        

        if (indexes.length === 0) {

            console.log(`Adding index on dateofbirth column in ${dbName}`);

            await connection.query(`

                ALTER TABLE studentdetails 

                ADD INDEX idx_dateofbirth (dateofbirth)

            `);

            console.log(`✅ Index on dateofbirth added successfully to ${dbName}`);

        }

        

        // Add index on student_house for better performance

        const [houseIndexes] = await connection.query(`

            SELECT INDEX_NAME 

            FROM INFORMATION_SCHEMA.STATISTICS 

            WHERE TABLE_SCHEMA = ? 

            AND TABLE_NAME = 'studentdetails' 

            AND INDEX_NAME = 'idx_student_house'

        `, [dbName]);

        

        if (houseIndexes.length === 0) {

            console.log(`Adding index on student_house column in ${dbName}`);

            await connection.query(`

                ALTER TABLE studentdetails 

                ADD INDEX idx_student_house (student_house)

            `);

            console.log(`✅ Index on student_house added successfully to ${dbName}`);

        }

        

    } catch (error) {

        console.error(`Error migrating database ${dbName}:`, error);

    }

}



// Helper function to create database and tables for a developer

async function createDeveloperDatabase(developerUsername) {

    const connection = await masterPool.getConnection();

    try {

        const dbName = `user_${developerUsername.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);

        await connection.query(`USE \`${dbName}\``);

        

        // Create users table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS users (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'developer',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_role (role)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create admins table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS admins (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'admin',

                registered_by VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_registered_by (registered_by)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create subadmins table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS subadmins (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'subadmin',

                registered_by VARCHAR(255),

                developer VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_developer (developer)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create teachers table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS teachers (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'teacher',

                class VARCHAR(255),

                assigned_classes JSON,

                registered_by VARCHAR(255),

                developer VARCHAR(255),

                image_id VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_developer (developer),

                INDEX idx_class (class)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create students table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS students (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'student',

                class VARCHAR(255),

                registered_by VARCHAR(255),

                developer VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_developer (developer),

                INDEX idx_class (class)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create parents table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS parents (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                mobile VARCHAR(20) NOT NULL,

                password VARCHAR(255) NOT NULL,

                role VARCHAR(50) DEFAULT 'parent',

                student VARCHAR(255),

                child_ids JSON,

                registered_by VARCHAR(255),

                developer VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_developer (developer),

                INDEX idx_student (student)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create studentdetails table with dateofbirth and student_house

        await connection.query(`

            CREATE TABLE IF NOT EXISTS studentdetails (

                id INT AUTO_INCREMENT PRIMARY KEY,

                username VARCHAR(255) UNIQUE NOT NULL,

                name VARCHAR(255) NOT NULL,

                father_name VARCHAR(255),

                mother_name VARCHAR(255),

                student_house VARCHAR(100),

                class VARCHAR(255),

                address TEXT,

                phone1 VARCHAR(20),

                student_id VARCHAR(255),

                image_id VARCHAR(255),

                admissionnumber VARCHAR(255),

                dateofbirth VARCHAR(50),

                created_by VARCHAR(255),

                developer VARCHAR(255),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                INDEX idx_username (username),

                INDEX idx_developer (developer),

                INDEX idx_class (class),

                INDEX idx_student_id (student_id),

                INDEX idx_admissionnumber (admissionnumber),

                INDEX idx_dateofbirth (dateofbirth),

                INDEX idx_student_house (student_house)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create images table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS images (

                id INT AUTO_INCREMENT PRIMARY KEY,

                image_id VARCHAR(255) UNIQUE NOT NULL,

                filename VARCHAR(255) NOT NULL,

                content_type VARCHAR(100),

                size INT,

                data LONGBLOB,

                user_id VARCHAR(255),

                user_role VARCHAR(50),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_image_id (image_id),

                INDEX idx_user_id (user_id)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        // Create teacher_images table

        await connection.query(`

            CREATE TABLE IF NOT EXISTS teacher_images (

                id INT AUTO_INCREMENT PRIMARY KEY,

                image_id VARCHAR(255) UNIQUE NOT NULL,

                filename VARCHAR(255) NOT NULL,

                content_type VARCHAR(100),

                size INT,

                data LONGBLOB,

                user_id VARCHAR(255),

                user_role VARCHAR(50),

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                INDEX idx_image_id (image_id),

                INDEX idx_user_id (user_id)

            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

        `);

        

        console.log(`✅ Database and tables created for developer: ${developerUsername}`);

        return dbName;

    } catch (error) {

        console.error('Error creating developer database:', error);

        throw error;

    } finally {

        connection.release();

    }

}



// Helper function to get user database NAME (does not cache connections anymore)

async function getUserDBName(username, isAdminOrSubadmin = false) {

    if (dbNameCache.has(username)) {

        return dbNameCache.get(username);

    }



    const connection = await masterPool.getConnection();

    try {

        if (isAdminOrSubadmin) {

            const [databases] = await connection.query('SHOW DATABASES LIKE "user_%"');

            

            for (const dbRow of databases) {

                const dbName = Object.values(dbRow)[0];

                await connection.query(`USE \`${dbName}\``);

                

                const tables = ['admins', 'subadmins', 'teachers', 'parents', 'students'];

                

                for (const table of tables) {

                    const [rows] = await connection.query(

                        `SELECT * FROM ${table} WHERE username = ?`,

                        [username]

                    );

                    

                    if (rows.length > 0) {

                        await migrateDatabase(connection, dbName);

                        dbNameCache.set(username, dbName);

                        return dbName;

                    }

                }

            }

            throw new Error('User not found in any developer database');

        } else {

            const dbName = `user_${username.replace(/[^a-zA-Z0-9_]/g, '_')}`;

            await connection.query(`USE \`${dbName}\``);

            await migrateDatabase(connection, dbName);

            dbNameCache.set(username, dbName);

            return dbName;

        }

    } finally {

        connection.release(); // ALWAYS release the temporary connection

    }

}



// Authentication Middleware - Gets a fresh connection for EVERY request

async function authenticate(req, res, next) {

    let connection;

    try {

        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {

            return res.status(401).json({ error: 'Authentication required' });

        }



        const decoded = jwt.verify(token, JWT_SECRET);

        req.username = decoded.username;

        req.role = decoded.role;

        req.userId = decoded.userId;



        // 1. Get a fresh connection for this request

        connection = await masterPool.getConnection();

        

        // 2. Automatically release the connection when the response finishes

        res.on('finish', () => {

            if (connection) {

                connection.release();

                connection = null;

            }

        });



        if (decoded.role === 'developer') {

            const dbName = await getUserDBName(decoded.username);

            await connection.query(`USE \`${dbName}\``);

            req.db = connection;

            req.dbName = dbName;

            return next();

        }



        const [databases] = await connection.query('SHOW DATABASES LIKE "user_%"');

        let userFound = false;

        

        for (const dbRow of databases) {

            const dbName = Object.values(dbRow)[0];

            await connection.query(`USE \`${dbName}\``);

            

            const tables = ['admins', 'subadmins', 'teachers', 'parents', 'students'];

            

            for (const table of tables) {

                const [rows] = await connection.query(

                    `SELECT * FROM ${table} WHERE username = ?`,

                    [decoded.username]

                );

                

                if (rows.length > 0) {

                    req.db = connection;

                    req.dbName = dbName;

                    req.userData = rows[0];

                    

                    if (rows[0].registered_by) req.admin = rows[0].registered_by;

                    if (rows[0].developer) req.developer = rows[0].developer;

                    

                    userFound = true;

                    break;

                }

            }

            if (userFound) break;

        }



        if (!userFound) {

            return res.status(403).json({ error: 'User account not found in any database' });

        }

        

        next();

    } catch (error) {

        console.error('Authentication error:', error);

        if (connection && !res.headersSent) {

            connection.release();

            connection = null;

        }

        res.status(401).json({ error: 'Invalid or expired token' });

    }

}



function authorize(roles = []) {

    return (req, res, next) => {

        if (!roles.includes(req.role)) {

            return res.status(403).json({ error: 'Unauthorized access' });

        }

        next();

    };

}



// Developer Registration Route

app.post('/register', async (req, res) => {

    const { username, mobile, password, confirmPassword, role = 'developer' } = req.body;



    if (!username || !mobile || !password || !confirmPassword) {

        return res.status(400).json({ error: 'All fields are required' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    if (role !== 'developer') {

        return res.status(403).json({ error: 'Invalid role for public registration' });

    }



    let connection;

    try {

        const dbName = await createDeveloperDatabase(username);

        

        connection = await masterPool.getConnection();

        await connection.query(`USE \`${dbName}\``);

        

        const [existingUsers] = await connection.query(

            'SELECT * FROM users WHERE username = ?',

            [username]

        );

        

        if (existingUsers.length > 0) {

            return res.status(400).json({ error: 'User already exists' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        await connection.query(

            'INSERT INTO users (username, mobile, password, role) VALUES (?, ?, ?, ?)',

            [username, mobile, hashedPassword, role]

        );



        res.status(201).json({ 

            message: 'User registered successfully',

            username

        });

    } catch (error) {

        console.error('Registration error:', error);

        res.status(500).json({ error: 'Error registering user: ' + error.message });

    } finally {

        if (connection) connection.release();

    }

});



// Admin Registration Route

app.post('/register-admin', authenticate, authorize(['developer']), async (req, res) => {

    const { username, mobile, password, confirmPassword } = req.body;



    if (!username || !mobile || !password || !confirmPassword) {

        return res.status(400).json({ error: 'All fields are required' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    try {

        const connection = req.db;

        

        const [existingAdmin] = await connection.query(

            'SELECT * FROM admins WHERE username = ?',

            [username]

        );

        

        if (existingAdmin.length > 0) {

            return res.status(400).json({ error: 'Admin already exists' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        await connection.query(

            'INSERT INTO admins (username, mobile, password, role, registered_by) VALUES (?, ?, ?, ?, ?)',

            [username, mobile, hashedPassword, 'admin', req.username]

        );



        res.status(201).json({ 

            message: 'Admin registered successfully',

            username

        });

    } catch (error) {

        console.error('Admin registration error:', error);

        res.status(500).json({ error: 'Error registering admin' });

    }

});



// Subadmin registration

app.post('/register-subadmin', authenticate, authorize(['developer', 'admin']), async (req, res) => {

    const { username, mobile, password, confirmPassword } = req.body;



    if (!username || !mobile || !password || !confirmPassword) {

        return res.status(400).json({ error: 'All fields are required' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    try {

        const developerUsername = req.role === 'developer' ? req.username : req.admin;



        if (!developerUsername) {

            return res.status(403).json({ error: 'Cannot determine developer account' });

        }



        const connection = req.db;



        const [existingSubadmin] = await connection.query(

            'SELECT * FROM subadmins WHERE username = ?',

            [username]

        );

        

        if (existingSubadmin.length > 0) {

            return res.status(400).json({ error: 'Subadmin already exists' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        await connection.query(

            'INSERT INTO subadmins (username, mobile, password, role, registered_by, developer) VALUES (?, ?, ?, ?, ?, ?)',

            [username, mobile, hashedPassword, 'subadmin', req.username, developerUsername]

        );



        res.status(201).json({

            message: 'Subadmin registered successfully',

            username

        });

    } catch (error) {

        console.error('Subadmin registration error:', error);

        res.status(500).json({ error: 'Error registering subadmin' });

    }

});



// Teachers registration

app.post('/register-teacher', authenticate, authorize(['developer', 'admin', 'subadmin']), upload.single('image'), async (req, res) => {

    const { username, mobile, password, confirmPassword, teacherClass } = req.body;



    if (!username || !mobile || !password || !confirmPassword) {

        return res.status(400).json({ error: 'All fields are required' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    try {

        let developerUsername;

        if (req.role === 'developer') {

            developerUsername = req.username;

        } else if (req.role === 'admin') {

            developerUsername = req.admin;

        } else if (req.role === 'subadmin') {

            developerUsername = req.developer;

        }



        if (!developerUsername) {

            return res.status(403).json({ error: 'Cannot determine developer account' });

        }



        const connection = req.db;



        const [existingTeacher] = await connection.query(

            'SELECT * FROM teachers WHERE username = ?',

            [username]

        );

        

        if (existingTeacher.length > 0) {

            return res.status(400).json({ error: 'Teacher already exists' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        const teacherData = {

            username,

            mobile,

            password: hashedPassword,

            role: 'teacher',

            class: teacherClass,

            assigned_classes: JSON.stringify(Array.isArray(teacherClass) ? teacherClass : [teacherClass]),

            registered_by: req.username,

            developer: developerUsername

        };



        if (req.file) {

            const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const fileBuffer = fs.readFileSync(req.file.path);

            

            await connection.query(

                'INSERT INTO teacher_images (image_id, filename, content_type, size, data, user_id, user_role) VALUES (?, ?, ?, ?, ?, ?, ?)',

                [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer, username, 'teacher']

            );

            

            teacherData.image_id = imageId;

            fs.unlinkSync(req.file.path);

        }



        await connection.query(

            'INSERT INTO teachers (username, mobile, password, role, class, assigned_classes, registered_by, developer, image_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',

            [teacherData.username, teacherData.mobile, teacherData.password, teacherData.role, teacherData.class, teacherData.assigned_classes, teacherData.registered_by, teacherData.developer, teacherData.image_id || null]

        );



        res.status(201).json({

            message: 'Teacher registered successfully',

            username,

            imageId: teacherData.image_id || null

        });

    } catch (error) {

        console.error('Teacher registration error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: 'Error registering Teacher' });

    }

});



// Parent registration

app.post('/register-parent', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), async (req, res) => {

    const { username, mobile, password, confirmPassword, studentUsername } = req.body;



    if (!username || !mobile || !password || !confirmPassword || !studentUsername) {

        return res.status(400).json({ error: 'All fields are required' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    try {

        let developerUsername;

        if (req.role === 'developer') {

            developerUsername = req.username;

        } else if (req.role === 'admin') {

            developerUsername = req.admin;

        } else if (req.role === 'subadmin') {

            developerUsername = req.developer;

        } else if (req.role === 'teacher') {

            developerUsername = req.developer;

        }



        if (!developerUsername) {

            return res.status(403).json({ error: 'Cannot determine developer account' });

        }



        const connection = req.db;



        const [existingParent] = await connection.query(

            'SELECT * FROM parents WHERE username = ?',

            [username]

        );

        

        if (existingParent.length > 0) {

            return res.status(400).json({ error: 'Parent already exists' });

        }



        const [student] = await connection.query(

            'SELECT * FROM students WHERE username = ?',

            [studentUsername]

        );

        

        if (student.length === 0) {

            return res.status(400).json({ error: 'Student does not exist' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        await connection.query(

            'INSERT INTO parents (username, mobile, password, role, student, child_ids, registered_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',

            [username, mobile, hashedPassword, 'parent', studentUsername, JSON.stringify([student[0].id]), req.username, developerUsername]

        );



        res.status(201).json({

            message: 'Parent registered successfully',

            username

        });

    } catch (error) {

        console.error('Parent registration error:', error);

        res.status(500).json({ error: 'Error registering Parent' });

    }

});



// Student registration

app.post('/register-student', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), async (req, res) => {

    const { username, mobile, password, confirmPassword, studentClass, name, fatherName, motherName, studentHouse, address, phone1, dateofbirth } = req.body;



    if (!username || !mobile || !password || !confirmPassword || !studentClass) {

        return res.status(400).json({ error: 'All required fields must be filled' });

    }



    if (password !== confirmPassword) {

        return res.status(400).json({ error: 'Passwords do not match' });

    }



    if (password.length < 6) {

        return res.status(400).json({ error: 'Password must be at least 6 characters' });

    }



    if (!/^\d{10,15}$/.test(mobile)) {

        return res.status(400).json({ error: 'Invalid mobile number' });

    }



    try {

        let developerUsername;

        if (req.role === 'developer') {

            developerUsername = req.username;

        } else if (req.role === 'admin') {

            developerUsername = req.admin;

        } else if (req.role === 'subadmin') {

            developerUsername = req.developer;

        } else if (req.role === 'teacher') {

            developerUsername = req.developer;

        }



        if (!developerUsername) {

            return res.status(403).json({ error: 'Cannot determine developer account' });

        }



        const connection = req.db;



        const [existingStudent] = await connection.query(

            'SELECT * FROM students WHERE username = ?',

            [username]

        );

        

        if (existingStudent.length > 0) {

            return res.status(400).json({ error: 'Student already exists' });

        }



        const hashedPassword = await bcrypt.hash(password, 10);



        const [studentResult] = await connection.query(

            'INSERT INTO students (username, mobile, password, role, class, registered_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?)',

            [username, mobile, hashedPassword, 'student', studentClass, req.username, developerUsername]

        );



        await connection.query(

            'INSERT INTO studentdetails (username, name, father_name, mother_name, student_house, class, address, phone1, student_id, dateofbirth, created_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',

            [username, name || username, fatherName || '', motherName || '', studentHouse || '', studentClass, address || '', phone1 || mobile, studentResult.insertId.toString(), dateofbirth || null, req.username, developerUsername]

        );



        res.status(201).json({

            message: 'Student registered successfully',

            username,

            studentId: studentResult.insertId

        });

    } catch (error) {

        console.error('Student registration error:', error);

        res.status(500).json({ error: 'Error registering Student' });

    }

});



// Login Route

app.post('/login', async (req, res) => {

    const { username, password } = req.body;



    if (!username || !password) {

        return res.status(400).json({ error: 'Username and password are required' });

    }



    let connection;

    try {

        let user = null;

        let userRole = null;

        let userId = null;

        let foundDbName = null;

        

        connection = await masterPool.getConnection();

        

        const [databases] = await connection.query('SHOW DATABASES LIKE "user_%"');

        

        for (const dbRow of databases) {

            const dbName = Object.values(dbRow)[0];

            

            await connection.query(`USE \`${dbName}\``);

            

            const [users] = await connection.query(

                'SELECT * FROM users WHERE username = ?',

                [username]

            );

            

            if (users.length > 0) {

                user = users[0];

                userRole = 'developer';

                userId = user.id;

                foundDbName = dbName;

                break;

            }

            

            const tables = ['admins', 'subadmins', 'teachers', 'parents', 'students'];

            for (const table of tables) {

                const [rows] = await connection.query(

                    `SELECT * FROM ${table} WHERE username = ?`,

                    [username]

                );

                

                if (rows.length > 0) {

                    user = rows[0];

                    userRole = table === 'admins' ? 'admin' : 

                              table === 'subadmins' ? 'subadmin' :

                              table === 'teachers' ? 'teacher' :

                              table === 'parents' ? 'parent' : 'student';

                    userId = user.id;

                    foundDbName = dbName;

                    break;

                }

            }

            

            if (user) break;

        }



        if (!user) {

            return res.status(401).json({ error: 'Invalid credentials' });

        }



        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {

            return res.status(401).json({ error: 'Invalid credentials' });

        }



        const token = jwt.sign({ 

            username, 

            role: userRole, 

            userId: userId.toString(),

            dbName: foundDbName

        }, JWT_SECRET, { expiresIn: '6h' });

        

        res.json({ 

            token, 

            username,

            role: userRole,

            message: 'Login successful'

        });

    } catch (error) {

        console.error('Login error:', error);

        res.status(500).json({ error: 'Error during login' });

    } finally {

        if (connection) connection.release();

    }

});



// Test endpoint

app.get('/profile', authenticate, (req, res) => {

    res.json({

        username: req.username,

        role: req.role,

        message: 'Authentication successful'

    });

});



// Create student with details

app.post('/api/students', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), upload.single('image'), async (req, res) => {

    try {

        if (!req.body.data) {

            return res.status(400).json({ error: 'Student data is required' });

        }



        const connection = req.db;

        const studentData = JSON.parse(req.body.data);

        let imageId = null;



        if (!studentData.name || !studentData.fatherName || !studentData.motherName || 

            !studentData.class || !studentData.address || !studentData.phone1 || !studentData.username) {

            return res.status(400).json({ error: 'All required fields including username must be filled' });

        }



        const [existingStudent] = await connection.query(

            'SELECT * FROM students WHERE username = ?',

            [studentData.username]

        );

        

        if (existingStudent.length > 0) {

            return res.status(400).json({ error: 'Student username already exists' });

        }



        const [existingDetails] = await connection.query(

            'SELECT * FROM studentdetails WHERE username = ?',

            [studentData.username]

        );

        

        if (existingDetails.length > 0) {

            return res.status(400).json({ error: 'Student details already exist for this username' });

        }



        if (req.file) {

            imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const fileBuffer = fs.readFileSync(req.file.path);

            

            await connection.query(

                'INSERT INTO images (image_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',

                [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer]

            );

            

            fs.unlinkSync(req.file.path);

        }



        const hashedPassword = await bcrypt.hash('defaultPassword123', 10);

        

        const [studentRecord] = await connection.query(

            'INSERT INTO students (username, mobile, password, role, class, registered_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?)',

            [studentData.username, studentData.phone1, hashedPassword, 'student', studentData.class, req.username, req.developer || req.username]

        );



        const [result] = await connection.query(

            'INSERT INTO studentdetails (username, name, father_name, mother_name, student_house, class, address, phone1, student_id, image_id, dateofbirth, created_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',

            [studentData.username, studentData.name, studentData.fatherName, studentData.motherName, studentData.studentHouse || null, studentData.class, studentData.address, studentData.phone1, studentRecord.insertId.toString(), imageId, studentData.dateofbirth || null, req.username, req.developer || req.username]

        );

        

        res.status(201).json({

            message: "Student created successfully",

            student: { id: result.insertId, ...studentData, imageId }

        });

    } catch (error) {

        console.error('Create student error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to create student: " + error.message });

    }

});



// Get all students

app.get('/api/students', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'parent', 'student']), async (req, res) => {

    try {

        const connection = req.db;

        

        let query = 'SELECT * FROM studentdetails';

        let queryParams = [];

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                break;

                

            case 'teacher':

                if (req.userData && req.userData.assigned_classes) {

                    const assignedClasses = typeof req.userData.assigned_classes === 'string' 

                        ? JSON.parse(req.userData.assigned_classes) 

                        : req.userData.assigned_classes;

                        

                    const placeholders = assignedClasses.map(() => '?').join(',');

                    query += ` WHERE class IN (${placeholders})`;

                    queryParams = assignedClasses;

                } else if (req.userData && req.userData.class) {

                    query += ' WHERE class = ?';

                    queryParams = [req.userData.class];

                }

                break;

                

            case 'parent':

                if (req.userData && req.userData.child_ids) {

                    const childIds = typeof req.userData.child_ids === 'string'

                        ? JSON.parse(req.userData.child_ids)

                        : req.userData.child_ids;

                        

                    const placeholders = childIds.map(() => '?').join(',');

                    query += ` WHERE student_id IN (${placeholders})`;

                    queryParams = childIds;

                } else if (req.userData && req.userData.student) {

                    query += ' WHERE username = ?';

                    queryParams = [req.userData.student];

                }

                break;

                

            case 'student':

                query += ' WHERE username = ?';

                queryParams = [req.username];

                break;

        }

        

        query += ' ORDER BY created_at DESC';

        

        const [students] = await connection.query(query, queryParams);

        

        const studentsWithImageUrls = students.map(student => {

            const studentWithUrl = { ...student };

            if (student.image_id) {

                studentWithUrl.imageUrl = `/api/images/${student.image_id}`;

            }

            delete studentWithUrl.data;

            return studentWithUrl;

        });

        

        res.json(studentsWithImageUrls);

    } catch (error) {

        console.error('Get students error:', error);

        res.status(500).json({ error: "Failed to fetch students: " + error.message });

    }

});



// Get single student

app.get('/api/students/:id', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'parent', 'student']), async (req, res) => {

    try {

        const connection = req.db;

        

        let student;

        

        if (!isNaN(parseInt(req.params.id))) {

            [student] = await connection.query(

                'SELECT * FROM studentdetails WHERE id = ?',

                [parseInt(req.params.id)]

            );

            student = student[0];

        } else {

            [student] = await connection.query(

                'SELECT * FROM studentdetails WHERE username = ?',

                [req.params.id]

            );

            student = student[0];

        }

        

        if (!student) {

            return res.status(404).json({ error: "Student not found" });

        }

        

        let hasAccess = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                hasAccess = true;

                break;

                

            case 'teacher':

                if (req.userData && req.userData.assigned_classes) {

                    const assignedClasses = typeof req.userData.assigned_classes === 'string'

                        ? JSON.parse(req.userData.assigned_classes)

                        : req.userData.assigned_classes;

                        

                    if (assignedClasses.includes(student.class)) {

                        hasAccess = true;

                    }

                }

                break;

                

            case 'parent':

                if (req.userData && req.userData.child_ids) {

                    const childIds = typeof req.userData.child_ids === 'string'

                        ? JSON.parse(req.userData.child_ids)

                        : req.userData.child_ids;

                        

                    if (childIds.includes(student.student_id)) {

                        hasAccess = true;

                    }

                } else if (req.userData && req.userData.student === student.username) {

                    hasAccess = true;

                }

                break;

                

            case 'student':

                if (student.username === req.username) {

                    hasAccess = true;

                }

                break;

        }

        

        if (!hasAccess) {

            return res.status(403).json({ error: "Access denied" });

        }

        

        if (student.image_id) {

            student.imageUrl = `/api/images/${student.image_id}`;

        }

        delete student.data;

        

        res.json(student);

    } catch (error) {

        console.error('Get student error:', error);

        res.status(500).json({ error: "Failed to fetch student" });

    }

});



// Update student

app.patch('/api/students/:id', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'student']), async (req, res) => {

    try {

        const connection = req.db;

        const updateData = req.body;

        

        if (!updateData || Object.keys(updateData).length === 0) {

            return res.status(400).json({ error: 'No update data provided' });

        }

        

        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE id = ?',

            [parseInt(req.params.id)]

        );

        

        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student not found" });

        }

        

        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

            case 'teacher':

                hasPermission = true;

                break;

                

            case 'student':

                if (existingStudent[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }

        

        let allowedFields;

        if (req.role === 'student') {

            allowedFields = ['name', 'father_name', 'mother_name', 'student_house', 'address', 'phone1', 'class', 'dateofbirth'];

        } else {

            allowedFields = Object.keys(updateData);

        }

        

        const filteredUpdateData = {};

        const fieldMapping = {

            'name': 'name',

            'fatherName': 'father_name',

            'motherName': 'mother_name',

            'studentHouse': 'student_house',

            'address': 'address',

            'phone1': 'phone1',

            'class': 'class',

            'username': 'username',

            'dateofbirth': 'dateofbirth'

        };

        

        Object.keys(updateData).forEach(field => {

            if (allowedFields.includes(field)) {

                const dbField = fieldMapping[field] || field;

                filteredUpdateData[dbField] = updateData[field];

            }

        });

        

        if (Object.keys(filteredUpdateData).length === 0) {

            return res.status(400).json({ error: 'No valid fields provided for update' });

        }

        

        const setClause = Object.keys(filteredUpdateData).map(field => `${field} = ?`).join(', ');

        const values = [...Object.values(filteredUpdateData), parseInt(req.params.id)];

        

        const [result] = await connection.query(

            `UPDATE studentdetails SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,

            values

        );

        

        if (result.affectedRows === 0) {

            return res.status(400).json({ error: "No changes made to student details" });

        }

        

        if (filteredUpdateData.class || filteredUpdateData.username) {

            const studentUpdate = {};

            if (filteredUpdateData.class) studentUpdate.class = filteredUpdateData.class;

            if (filteredUpdateData.username) studentUpdate.username = filteredUpdateData.username;

            

            const studentSetClause = Object.keys(studentUpdate).map(field => `${field} = ?`).join(', ');

            const studentValues = [...Object.values(studentUpdate)];

            

            if (existingStudent[0].student_id) {

                studentValues.push(existingStudent[0].student_id);

                await connection.query(

                    `UPDATE students SET ${studentSetClause} WHERE id = ?`,

                    studentValues

                );

            } else {

                studentValues.push(existingStudent[0].username);

                await connection.query(

                    `UPDATE students SET ${studentSetClause} WHERE username = ?`,

                    studentValues

                );

            }

        }

        

        res.json({

            message: "Student updated successfully",

            updatedFields: Object.keys(filteredUpdateData)

        });

    } catch (error) {

        console.error('Update student error:', error);

        res.status(500).json({ error: "Failed to update student" });

    }

});



// Update student personal details

app.patch('/api/students/:id/personal-details', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'student']), async (req, res) => {

    try {

        const connection = req.db;

        const updateData = req.body;

        

        if (!updateData || Object.keys(updateData).length === 0) {

            return res.status(400).json({ error: 'No update data provided' });

        }

        

        const allowedFields = ['name', 'fatherName', 'motherName', 'studentHouse', 'address', 'phone1', 'class', 'dateofbirth'];

        const updateFields = {};

        const fieldMapping = {

            'name': 'name',

            'fatherName': 'father_name',

            'motherName': 'mother_name',

            'studentHouse': 'student_house',

            'address': 'address',

            'phone1': 'phone1',

            'class': 'class',

            'dateofbirth': 'dateofbirth'

        };

        

        Object.keys(updateData).forEach(field => {

            if (allowedFields.includes(field)) {

                const dbField = fieldMapping[field];

                updateFields[dbField] = updateData[field];

            }

        });

        

        if (Object.keys(updateFields).length === 0) {

            return res.status(400).json({ error: 'No valid personal details fields provided' });

        }

        

        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE id = ?',

            [parseInt(req.params.id)]

        );

        

        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student not found" });

        }

        

        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

            case 'teacher':

                hasPermission = true;

                break;

                

            case 'student':

                if (existingStudent[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }

        

        const setClause = Object.keys(updateFields).map(field => `${field} = ?`).join(', ');

        const values = [...Object.values(updateFields), parseInt(req.params.id)];

        

        const [result] = await connection.query(

            `UPDATE studentdetails SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,

            values

        );

        

        if (result.affectedRows === 0) {

            return res.status(400).json({ error: "No changes made to student details" });

        }

        

        if (updateFields.class) {

            if (existingStudent[0].student_id) {

                await connection.query(

                    'UPDATE students SET class = ? WHERE id = ?',

                    [updateFields.class, existingStudent[0].student_id]

                );

            } else {

                await connection.query(

                    'UPDATE students SET class = ? WHERE username = ?',

                    [updateFields.class, existingStudent[0].username]

                );

            }

        }

        

        res.json({

            message: "Student personal details updated successfully",

            updatedFields: Object.keys(updateFields)

        });

    } catch (error) {

        console.error('Update student personal details error:', error);

        res.status(500).json({ error: "Failed to update student personal details" });

    }

});



// Student self-update

app.patch('/api/student/profile', authenticate, authorize(['student']), async (req, res) => {

    try {

        const connection = req.db;

        const updateData = req.body;

        

        if (!updateData || Object.keys(updateData).length === 0) {

            return res.status(400).json({ error: 'No update data provided' });

        }

        

        const allowedFields = ['name', 'fatherName', 'motherName', 'studentHouse', 'address', 'phone1', 'dateofbirth'];

        const updateFields = {};

        const fieldMapping = {

            'name': 'name',

            'fatherName': 'father_name',

            'motherName': 'mother_name',

            'studentHouse': 'student_house',

            'address': 'address',

            'phone1': 'phone1',

            'dateofbirth': 'dateofbirth'

        };

        

        Object.keys(updateData).forEach(field => {

            if (allowedFields.includes(field)) {

                const dbField = fieldMapping[field];

                updateFields[dbField] = updateData[field];

            }

        });

        

        if (Object.keys(updateFields).length === 0) {

            return res.status(400).json({ error: 'No valid fields provided for update' });

        }

        

        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE username = ?',

            [req.username]

        );

        

        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student details not found" });

        }

        

        const setClause = Object.keys(updateFields).map(field => `${field} = ?`).join(', ');

        const values = [...Object.values(updateFields), req.username];

        

        const [result] = await connection.query(

            `UPDATE studentdetails SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE username = ?`,

            values

        );

        

        if (result.affectedRows === 0) {

            return res.status(400).json({ error: "No changes made to student details" });

        }

        

        res.json({

            message: "Profile updated successfully",

            updatedFields: Object.keys(updateFields)

        });

    } catch (error) {

        console.error('Student profile update error:', error);

        res.status(500).json({ error: "Failed to update profile" });

    }

});



// Get unique classes

app.get('/api/classes', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'parent']), async (req, res) => {

    try {

        const connection = req.db;

        

        let query = 'SELECT DISTINCT class FROM studentdetails';

        let queryParams = [];

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                break;

                

            case 'teacher':

                if (req.userData && req.userData.assigned_classes) {

                    const assignedClasses = typeof req.userData.assigned_classes === 'string'

                        ? JSON.parse(req.userData.assigned_classes)

                        : req.userData.assigned_classes;

                        

                    const placeholders = assignedClasses.map(() => '?').join(',');

                    query += ` WHERE class IN (${placeholders})`;

                    queryParams = assignedClasses;

                } else if (req.userData && req.userData.class) {

                    query += ' WHERE class = ?';

                    queryParams = [req.userData.class];

                }

                break;

                

            case 'parent':

                if (req.userData && req.userData.child_ids) {

                    const childIds = typeof req.userData.child_ids === 'string'

                        ? JSON.parse(req.userData.child_ids)

                        : req.userData.child_ids;

                        

                    const [students] = await connection.query(

                        `SELECT DISTINCT class FROM studentdetails WHERE student_id IN (${childIds.map(() => '?').join(',')})`,

                        childIds

                    );

                    return res.json(students.map(s => s.class));

                }

                break;

        }

        

        const [classes] = await connection.query(query, queryParams);

        const classList = classes.map(c => c.class).filter(Boolean);

        

        const sortedClasses = classList.sort((a, b) => {

            const numA = parseInt(a);

            const numB = parseInt(b);

            

            if (!isNaN(numA) && !isNaN(numB)) {

                return numA - numB;

            }

            

            return a.localeCompare(b);

        });

        

        res.json(sortedClasses);

    } catch (error) {

        console.error('Get classes error:', error);

        res.status(500).json({ error: "Failed to fetch classes: " + error.message });

    }

});



// Get students by class

app.get('/api/students/class/:className', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'parent']), async (req, res) => {

    try {

        const className = req.params.className;

        const connection = req.db;

        

        let query = 'SELECT * FROM studentdetails WHERE class = ?';

        let queryParams = [className];

        

        switch (req.role) {

            case 'teacher':

                if (req.userData && req.userData.assigned_classes) {

                    const assignedClasses = typeof req.userData.assigned_classes === 'string'

                        ? JSON.parse(req.userData.assigned_classes)

                        : req.userData.assigned_classes;

                        

                    if (!assignedClasses.includes(className)) {

                        return res.status(403).json({ error: "Access denied to this class" });

                    }

                }

                break;

                

            case 'parent':

                if (req.userData && req.userData.child_ids) {

                    const childIds = typeof req.userData.child_ids === 'string'

                        ? JSON.parse(req.userData.child_ids)

                        : req.userData.child_ids;

                        

                    query += ` AND student_id IN (${childIds.map(() => '?').join(',')})`;

                    queryParams = [className, ...childIds];

                }

                break;

        }

        

        const [students] = await connection.query(query + ' ORDER BY name ASC', queryParams);

        

        const studentsWithImageUrls = students.map(student => {

            const studentWithUrl = { ...student };

            if (student.image_id) {

                studentWithUrl.imageUrl = `/api/images/${student.image_id}`;

            }

            delete studentWithUrl.data;

            return studentWithUrl;

        });

        

        res.json(studentsWithImageUrls);

    } catch (error) {

        console.error('Get students by class error:', error);

        res.status(500).json({ error: "Failed to fetch students: " + error.message });

    }

});



// Update student image

app.put('/api/students/:id/image', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'student']), upload.single('image'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Image file is required' });

        }



        const connection = req.db;



        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE id = ?',

            [parseInt(req.params.id)]

        );



        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student not found" });

        }



        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

            case 'teacher':

                hasPermission = true;

                break;

                

            case 'student':

                if (existingStudent[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }



        const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const fileBuffer = fs.readFileSync(req.file.path);



        if (existingStudent[0].image_id) {

            await connection.query(

                'DELETE FROM images WHERE image_id = ?',

                [existingStudent[0].image_id]

            );

        }

        

        await connection.query(

            'INSERT INTO images (image_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',

            [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer]

        );



        await connection.query(

            'UPDATE studentdetails SET image_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',

            [imageId, parseInt(req.params.id)]

        );

        

        fs.unlinkSync(req.file.path);

        

        res.json({

            message: "Student image updated successfully",

            imageId,

            imageUrl: `/api/images/${imageId}`

        });

    } catch (error) {

        console.error('Update student image error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to update student image" });

    }

});



// Student self-image update

app.put('/api/student/profile/image', authenticate, authorize(['student']), upload.single('image'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Image file is required' });

        }



        const connection = req.db;



        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE username = ?',

            [req.username]

        );



        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student details not found" });

        }



        const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const fileBuffer = fs.readFileSync(req.file.path);



        if (existingStudent[0].image_id) {

            await connection.query(

                'DELETE FROM images WHERE image_id = ?',

                [existingStudent[0].image_id]

            );

        }

        

        await connection.query(

            'INSERT INTO images (image_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',

            [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer]

        );



        await connection.query(

            'UPDATE studentdetails SET image_id = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',

            [imageId, req.username]

        );

        

        fs.unlinkSync(req.file.path);

        

        res.json({

            message: "Profile image updated successfully",

            imageId,

            imageUrl: `/api/images/${imageId}`

        });

    } catch (error) {

        console.error('Student profile image update error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to update profile image" });

    }

});



// Delete student

app.delete('/api/students/:id', authenticate, authorize(['developer', 'admin', 'subadmin']), async (req, res) => {

    try {

        const connection = req.db;



        const [student] = await connection.query(

            'SELECT * FROM studentdetails WHERE id = ?',

            [parseInt(req.params.id)]

        );



        if (student.length === 0) {

            return res.status(404).json({ error: "Student not found" });

        }



        if (student[0].image_id) {

            await connection.query(

                'DELETE FROM images WHERE image_id = ?',

                [student[0].image_id]

            );

        }



        await connection.query(

            'DELETE FROM studentdetails WHERE id = ?',

            [parseInt(req.params.id)]

        );

        

        if (student[0].username) {

            await connection.query(

                'DELETE FROM students WHERE username = ?',

                [student[0].username]

            );

        } else if (student[0].student_id) {

            await connection.query(

                'DELETE FROM students WHERE id = ?',

                [student[0].student_id]

            );

        }

        

        res.json({ message: "Student deleted successfully from both tables" });

    } catch (error) {

        console.error('Delete student error:', error);

        res.status(500).json({ error: "Failed to delete student" });

    }

});



// Serve images

app.get('/api/images/:id', authenticate, async (req, res) => {

    try {

        const connection = req.db;



        const [images] = await connection.query(

            'SELECT * FROM images WHERE image_id = ?',

            [req.params.id]

        );



        if (images.length === 0) {

            return res.status(404).json({ error: 'Image not found' });

        }



        const image = images[0];

        

        res.set({

            'Content-Type': image.content_type || 'image/jpeg',

            'Content-Length': image.size,

            'Content-Disposition': `inline; filename="${image.filename}"`,

            'Cache-Control': 'public, max-age=31536000'

        });



        res.send(image.data);

    } catch (error) {

        console.error('Image serve error:', error);

        if (!res.headersSent) {

            res.status(500).json({ error: 'Error serving image' });

        }

    }

});



// Serve teacher images

app.get('/api/teacher-images/:id', authenticate, async (req, res) => {

    try {

        const connection = req.db;



        const [images] = await connection.query(

            'SELECT * FROM teacher_images WHERE image_id = ?',

            [req.params.id]

        );



        if (images.length === 0) {

            return res.status(404).json({ error: 'Teacher image not found' });

        }



        const image = images[0];

        

        res.set({

            'Content-Type': image.content_type || 'image/jpeg',

            'Content-Length': image.size,

            'Content-Disposition': `inline; filename="${image.filename}"`,

            'Cache-Control': 'public, max-age=31536000'

        });



        res.send(image.data);

    } catch (error) {

        console.error('Teacher image serve error:', error);

        if (!res.headersSent) {

            res.status(500).json({ error: 'Error serving teacher image' });

        }

    }

});



// Upload and parse Excel/CSV

app.post('/api/upload-excel', authenticate, authorize(['developer', 'admin', 'subadmin']), documentUpload.single('file'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Excel/CSV file is required' });

        }



        const workbook = xlsx.readFile(req.file.path);

        const firstSheetName = workbook.SheetNames[0];

        const worksheet = workbook.Sheets[firstSheetName];

        

        const jsonData = xlsx.utils.sheet_to_json(worksheet, { 

            raw: false,

            defval: ''

        });



        const normalizedData = jsonData.map(row => {

            const normalized = {};

            Object.keys(row).forEach(key => {

                const lowerKey = key.toLowerCase().replace(/[_\s]/g, '');

                if (lowerKey.includes('username') || lowerKey.includes('user')) {

                    normalized.username = row[key];

                } else if (lowerKey.includes('name') && !lowerKey.includes('father') && !lowerKey.includes('mother')) {

                    normalized.name = row[key];

                } else if (lowerKey.includes('father')) {

                    normalized.fatherName = row[key];

                } else if (lowerKey.includes('mother')) {

                    normalized.motherName = row[key];

                } else if (lowerKey.includes('house')) {

                    normalized.studentHouse = row[key];

                } else if (lowerKey.includes('class')) {

                    normalized.class = row[key];

                } else if (lowerKey.includes('address')) {

                    normalized.address = row[key];

                } else if (lowerKey.includes('phone') || lowerKey.includes('mobile') || lowerKey.includes('contact')) {

                    normalized.phone1 = row[key];

                } else if (lowerKey.includes('admission') || lowerKey.includes('roll') || lowerKey.includes('id')) {

                    normalized.admissionnumber = row[key];

                } else if (lowerKey.includes('dateofbirth') || lowerKey.includes('dob') || lowerKey.includes('birthdate') || lowerKey.includes('birth_date') || lowerKey.includes('date_of_birth')) {

                    normalized.dateofbirth = row[key];

                } else {

                    normalized[key] = row[key];

                }

            });

            return normalized;

        });



        if (fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }



        res.json({

            message: 'File processed successfully',

            data: normalizedData

        });



    } catch (error) {

        console.error('Excel processing error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: 'Failed to process Excel file' });

    }

});



// Get all teachers

app.get('/api/teachers', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), async (req, res) => {

    try {

        const connection = req.db;

        

        let query = 'SELECT id, username, mobile, role, class, assigned_classes, registered_by, developer, image_id, created_at FROM teachers';

        let queryParams = [];

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                break;

                

            case 'teacher':

                query += ' WHERE username = ?';

                queryParams = [req.username];

                break;

        }

        

        query += ' ORDER BY created_at DESC';

        

        const [teachers] = await connection.query(query, queryParams);

        

        const teachersWithImageUrls = teachers.map(teacher => {

            if (teacher.image_id) {

                teacher.imageUrl = `/api/teacher-images/${teacher.image_id}`;

            }

            return teacher;

        });

        

        res.json(teachersWithImageUrls);

    } catch (error) {

        console.error('Get teachers error:', error);

        res.status(500).json({ error: "Failed to fetch teachers: " + error.message });

    }

});



// Get single teacher

app.get('/api/teachers/:id', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), async (req, res) => {

    try {

        const connection = req.db;

        

        let teacher;

        

        if (!isNaN(parseInt(req.params.id))) {

            [teacher] = await connection.query(

                'SELECT id, username, mobile, role, class, assigned_classes, registered_by, developer, image_id, created_at FROM teachers WHERE id = ?',

                [parseInt(req.params.id)]

            );

            teacher = teacher[0];

        } else {

            [teacher] = await connection.query(

                'SELECT id, username, mobile, role, class, assigned_classes, registered_by, developer, image_id, created_at FROM teachers WHERE username = ?',

                [req.params.id]

            );

            teacher = teacher[0];

        }

        

        if (!teacher) {

            return res.status(404).json({ error: "Teacher not found" });

        }

        

        let hasAccess = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                hasAccess = true;

                break;

                

            case 'teacher':

                if (teacher.username === req.username) {

                    hasAccess = true;

                }

                break;

        }

        

        if (!hasAccess) {

            return res.status(403).json({ error: "Access denied" });

        }

        

        if (teacher.image_id) {

            teacher.imageUrl = `/api/teacher-images/${teacher.image_id}`;

        }

        

        res.json(teacher);

    } catch (error) {

        console.error('Get teacher error:', error);

        res.status(500).json({ error: "Failed to fetch teacher" });

    }

});



// Update teacher

app.patch('/api/teachers/:id', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), async (req, res) => {

    try {

        const connection = req.db;

        const updateData = req.body;

        

        if (!updateData || Object.keys(updateData).length === 0) {

            return res.status(400).json({ error: 'No update data provided' });

        }

        

        const [existingTeacher] = await connection.query(

            'SELECT * FROM teachers WHERE id = ?',

            [parseInt(req.params.id)]

        );

        

        if (existingTeacher.length === 0) {

            return res.status(404).json({ error: "Teacher not found" });

        }

        

        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                hasPermission = true;

                break;

                

            case 'teacher':

                if (existingTeacher[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }

        

        const allowedFields = ['mobile', 'class', 'assignedClasses'];

        const updateFields = {};

        const fieldMapping = {

            'mobile': 'mobile',

            'class': 'class',

            'assignedClasses': 'assigned_classes'

        };

        

        Object.keys(updateData).forEach(field => {

            if (allowedFields.includes(field)) {

                const dbField = fieldMapping[field];

                updateFields[dbField] = field === 'assignedClasses' ? JSON.stringify(updateData[field]) : updateData[field];

            }

        });

        

        if (Object.keys(updateFields).length === 0) {

            return res.status(400).json({ error: 'No valid fields provided for update' });

        }

        

        const setClause = Object.keys(updateFields).map(field => `${field} = ?`).join(', ');

        const values = [...Object.values(updateFields), parseInt(req.params.id)];

        

        const [result] = await connection.query(

            `UPDATE teachers SET ${setClause} WHERE id = ?`,

            values

        );

        

        if (result.affectedRows === 0) {

            return res.status(400).json({ error: "No changes made to teacher" });

        }

        

        res.json({

            message: "Teacher updated successfully",

            updatedFields: Object.keys(updateFields)

        });

    } catch (error) {

        console.error('Update teacher error:', error);

        res.status(500).json({ error: "Failed to update teacher" });

    }

});



// Update teacher image

app.put('/api/teachers/:id/image', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher']), upload.single('image'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Image file is required' });

        }



        const connection = req.db;



        const [existingTeacher] = await connection.query(

            'SELECT * FROM teachers WHERE id = ?',

            [parseInt(req.params.id)]

        );



        if (existingTeacher.length === 0) {

            return res.status(404).json({ error: "Teacher not found" });

        }



        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

                hasPermission = true;

                break;

                

            case 'teacher':

                if (existingTeacher[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }



        const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const fileBuffer = fs.readFileSync(req.file.path);



        if (existingTeacher[0].image_id) {

            await connection.query(

                'DELETE FROM teacher_images WHERE image_id = ?',

                [existingTeacher[0].image_id]

            );

        }

        

        await connection.query(

            'INSERT INTO teacher_images (image_id, filename, content_type, size, data, user_id, user_role) VALUES (?, ?, ?, ?, ?, ?, ?)',

            [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer, existingTeacher[0].username, 'teacher']

        );



        await connection.query(

            'UPDATE teachers SET image_id = ? WHERE id = ?',

            [imageId, parseInt(req.params.id)]

        );

        

        fs.unlinkSync(req.file.path);

        

        res.json({

            message: "Teacher image updated successfully",

            imageId,

            imageUrl: `/api/teacher-images/${imageId}`

        });

    } catch (error) {

        console.error('Update teacher image error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to update teacher image" });

    }

});



// Teacher self-image update

app.put('/api/teacher/profile/image', authenticate, authorize(['teacher']), upload.single('image'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Image file is required' });

        }



        const connection = req.db;



        const [existingTeacher] = await connection.query(

            'SELECT * FROM teachers WHERE username = ?',

            [req.username]

        );



        if (existingTeacher.length === 0) {

            return res.status(404).json({ error: "Teacher not found" });

        }



        const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const fileBuffer = fs.readFileSync(req.file.path);



        if (existingTeacher[0].image_id) {

            await connection.query(

                'DELETE FROM teacher_images WHERE image_id = ?',

                [existingTeacher[0].image_id]

            );

        }

        

        await connection.query(

            'INSERT INTO teacher_images (image_id, filename, content_type, size, data, user_id, user_role) VALUES (?, ?, ?, ?, ?, ?, ?)',

            [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer, req.username, 'teacher']

        );



        await connection.query(

            'UPDATE teachers SET image_id = ? WHERE username = ?',

            [imageId, req.username]

        );

        

        fs.unlinkSync(req.file.path);

        

        res.json({

            message: "Teacher profile image updated successfully",

            imageId,

            imageUrl: `/api/teacher-images/${imageId}`

        });

    } catch (error) {

        console.error('Teacher profile image update error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to update teacher profile image" });

    }

});



// Delete teacher

app.delete('/api/teachers/:id', authenticate, authorize(['developer', 'admin', 'subadmin']), async (req, res) => {

    try {

        const connection = req.db;



        const [teacher] = await connection.query(

            'SELECT * FROM teachers WHERE id = ?',

            [parseInt(req.params.id)]

        );



        if (teacher.length === 0) {

            return res.status(404).json({ error: "Teacher not found" });

        }



        if (teacher[0].image_id) {

            await connection.query(

                'DELETE FROM teacher_images WHERE image_id = ?',

                [teacher[0].image_id]

            );

        }



        await connection.query(

            'DELETE FROM teachers WHERE id = ?',

            [parseInt(req.params.id)]

        );

        

        res.json({ message: "Teacher deleted successfully" });

    } catch (error) {

        console.error('Delete teacher error:', error);

        res.status(500).json({ error: "Failed to delete teacher" });

    }

});



// Upload student image (alternative endpoint)

app.post('/api/upload-student-image', authenticate, authorize(['developer', 'admin', 'subadmin', 'teacher', 'student']), upload.single('image'), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({ error: 'Image file is required' });

        }



        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({ error: 'Student ID is required' });

        }



        const connection = req.db;



        const [existingStudent] = await connection.query(

            'SELECT * FROM studentdetails WHERE id = ?',

            [parseInt(studentId)]

        );



        if (existingStudent.length === 0) {

            return res.status(404).json({ error: "Student not found" });

        }



        let hasPermission = false;

        

        switch (req.role) {

            case 'developer':

            case 'admin':

            case 'subadmin':

            case 'teacher':

                hasPermission = true;

                break;

                

            case 'student':

                if (existingStudent[0].username === req.username) {

                    hasPermission = true;

                }

                break;

        }

        

        if (!hasPermission) {

            return res.status(403).json({ error: "Access denied" });

        }



        const imageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const fileBuffer = fs.readFileSync(req.file.path);



        if (existingStudent[0].image_id) {

            await connection.query(

                'DELETE FROM images WHERE image_id = ?',

                [existingStudent[0].image_id]

            );

        }

        

        await connection.query(

            'INSERT INTO images (image_id, filename, content_type, size, data) VALUES (?, ?, ?, ?, ?)',

            [imageId, req.file.originalname, req.file.mimetype, req.file.size, fileBuffer]

        );



        await connection.query(

            'UPDATE studentdetails SET image_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',

            [imageId, parseInt(studentId)]

        );

        

        fs.unlinkSync(req.file.path);

        

        res.json({

            message: "Student image updated successfully",

            imageId,

            imageUrl: `/api/images/${imageId}`

        });

    } catch (error) {

        console.error('Upload student image error:', error);

        if (req.file && fs.existsSync(req.file.path)) {

            fs.unlinkSync(req.file.path);

        }

        res.status(500).json({ error: "Failed to upload student image" });

    }

});



// Batch create students with duplicate prevention

app.post('/api/students/batch', authenticate, authorize(['developer', 'admin', 'subadmin']), async (req, res) => {

    try {

        const { students } = req.body;

        

        if (!Array.isArray(students) || students.length === 0) {

            return res.status(400).json({ error: 'Students array is required' });

        }



        const connection = req.db;

        

        let insertedCount = 0;

        let skippedCount = 0;

        let duplicateCount = 0;

        const duplicates = [];



        for (const student of students) {

            const mappedStudent = {

                username: student.username || student.Username || student.USERNAME || `student_${Date.now()}_${Math.random()}`,

                name: student.name || student.Name || student.NAME || '',

                fatherName: student.fatherName || student.father_name || student.FatherName || student.FATHERNAME || '',

                motherName: student.motherName || student.mother_name || student.MotherName || student.MOTHERNAME || '',

                studentHouse: student.studentHouse || student.student_house || student.StudentHouse || student.STUDENTHOUSE || student.house || student.House || '',

                class: student.class || student.Class || student.CLASS || '',

                address: student.address || student.Address || student.ADDRESS || '',

                phone1: student.phone1 || student.Phone1 || student.PHONE1 || student.mobile || student.Mobile || '0000000000',

                admissionnumber: student.admissionnumber || student.AdmissionNumber || student.ADMISSIONNUMBER || student.admission_no || student.AdmissionNo || null,

                dateofbirth: student.dateofbirth || student.dateOfBirth || student.DateOfBirth || student.DOB || student.dob || null

            };



            const checkConditions = [];

            const checkParams = [];

            

            if (mappedStudent.username && mappedStudent.username !== `student_${Date.now()}_${Math.random()}`) {

                checkConditions.push('username = ?');

                checkParams.push(mappedStudent.username);

            }

            

            if (mappedStudent.admissionnumber) {

                checkConditions.push('admissionnumber = ?');

                checkParams.push(mappedStudent.admissionnumber);

            }

            

            if (mappedStudent.name && mappedStudent.fatherName && mappedStudent.motherName) {

                checkConditions.push('(name = ? AND father_name = ? AND mother_name = ?)');

                checkParams.push(mappedStudent.name, mappedStudent.fatherName, mappedStudent.motherName);

            }



            if (checkConditions.length > 0) {

                const [existingStudent] = await connection.query(

                    `SELECT * FROM studentdetails WHERE ${checkConditions.join(' OR ')}`,

                    checkParams

                );

                

                if (existingStudent.length > 0) {

                    duplicateCount++;

                    duplicates.push({

                        student: mappedStudent,

                        reason: 'Student already exists in database',

                        existingId: existingStudent[0].id

                    });

                    continue;

                }

            }



            try {

                await connection.beginTransaction();



                const [existingStudentUser] = await connection.query(

                    'SELECT * FROM students WHERE username = ?',

                    [mappedStudent.username]

                );



                let studentId;

                

                if (existingStudentUser.length === 0) {

                    const hashedPassword = await bcrypt.hash('defaultPassword123', 10);

                    const [studentRecord] = await connection.query(

                        'INSERT INTO students (username, mobile, password, role, class, registered_by, developer) VALUES (?, ?, ?, ?, ?, ?, ?)',

                        [mappedStudent.username, mappedStudent.phone1, hashedPassword, 'student', mappedStudent.class, req.username, req.developer || req.username]

                    );

                    studentId = studentRecord.insertId;

                } else {

                    studentId = existingStudentUser[0].id;

                }



                await connection.query(

                    `INSERT INTO studentdetails 

                    (username, name, father_name, mother_name, student_house, class, address, phone1, student_id, admissionnumber, dateofbirth, created_by, developer) 

                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

                    [

                        mappedStudent.username, 

                        mappedStudent.name, 

                        mappedStudent.fatherName || '', 

                        mappedStudent.motherName || '', 

                        mappedStudent.studentHouse || '',

                        mappedStudent.class, 

                        mappedStudent.address || '', 

                        mappedStudent.phone1, 

                        studentId.toString(),

                        mappedStudent.admissionnumber,

                        mappedStudent.dateofbirth,

                        req.username, 

                        req.developer || req.username

                    ]

                );



                await connection.commit();

                insertedCount++;

                

            } catch (insertError) {

                await connection.rollback();

                console.error('Error inserting student:', insertError);

                skippedCount++;

            }

        }



        const message = `Upload complete. Inserted: ${insertedCount}, Duplicates skipped: ${duplicateCount}, Errors: ${skippedCount}`;

        

        res.json({

            message,

            summary: {

                total: students.length,

                inserted: insertedCount,

                duplicates: duplicateCount,

                skipped: skippedCount

            },

            duplicates: duplicates.length > 0 ? duplicates : undefined

        });



    } catch (error) {

        console.error('Batch upload error:', error);

        res.status(500).json({ 

            error: 'Failed to upload students',

            details: error.message 

        });

    }

});



// Check if student exists

app.get('/api/students/check', authenticate, async (req, res) => {

    try {

        const { username, admissionnumber } = req.query;

        

        const connection = req.db;

        let query = 'SELECT * FROM studentdetails WHERE';

        let params = [];

        

        if (username) {

            query += ' username = ?';

            params.push(username);

        } else if (admissionnumber) {

            query += ' admissionnumber = ?';

            params.push(admissionnumber);

        } else {

            return res.status(400).json({ error: 'Username or admission number is required' });

        }

        

        const [student] = await connection.query(query, params);

        

        res.json({

            exists: student.length > 0,

            student: student[0] || null

        });

    } catch (error) {

        console.error('Error checking student:', error);

        res.status(500).json({ error: 'Failed to check student' });

    }

});



// Error handling middleware

app.use((err, req, res, next) => {

    console.error('Global error handler:', err);

    

    if (err instanceof multer.MulterError) {

        return res.status(400).json({ error: 'File upload error: ' + err.message });

    } else if (err) {

        return res.status(500).json({ error: err.message || 'Something went wrong' });

    }

    

    next();

});



// Create temp uploads directory

const uploadDir = path.join(__dirname, 'temp_uploads');

if (!fs.existsSync(uploadDir)) {

    fs.mkdirSync(uploadDir, { recursive: true });

}



// Start the server

async function startServer() {

    try {

        console.log('🔌 Testing database connection...');

        

        const connection = await masterPool.getConnection();

        console.log('✅ Successfully connected to TiDB database');

        

        const [rows] = await connection.query('SELECT VERSION() as version');

        console.log('TiDB Version:', rows[0].version);

        

        await connection.query('CREATE DATABASE IF NOT EXISTS test');

        console.log('✅ Database initialization successful');

        

        // Run migration on the test database as well

        await migrateDatabase(connection, 'test');

        

        connection.release();

        

        const port = process.env.PORT || 10000;

        

        app.listen(port, '0.0.0.0', () => {

            console.log(`🚀 Server started on port ${port}`);

            console.log(`✅ Ready to accept requests`);

            console.log(`📊 API endpoints available at http://localhost:${port}`);

            console.log(`💚 Health check: http://localhost:${port}/health`);

        });

    } catch (error) {

        console.error('❌ Database connection failed:', error.message);

        console.error('Full error details:', error);

        process.exit(1);

    }

}



// Start the server

startServer();



// Graceful shutdown

process.on('SIGINT', async () => {

    console.log('\n🛑 Shutting down server...');

    

    await masterPool.end();

    console.log('✅ Database connections closed');

    

    if (fs.existsSync(uploadDir)) {

        fs.rmSync(uploadDir, { recursive: true, force: true });

        console.log('✅ Cleaned up temporary uploads');

    }

    

    console.log('✅ Server shutdown complete');

    process.exit(0);

});



process.on('SIGTERM', async () => {

    console.log('Received SIGTERM, shutting down...');

    await masterPool.end();

    process.exit(0);

});
