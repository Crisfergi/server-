require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');
const catalogosRoutes = require('./routes/catalogosRoutes');

app.use('/api', authRoutes);
app.use('/api', dataRoutes);
app.use('/api', catalogosRoutes);

app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});