const express = require('express');
const { statusSnapshot } = require('../scenarios');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(statusSnapshot());
});

module.exports = router;
