// src/routes/alloy-test.js
const express = require('express');
const router = express.Router();

// Uma rota simples para teste
router.get('/', (req, res) => {
  res.json({ message: 'Alloy router funcionando!' });
});

module.exports = router;