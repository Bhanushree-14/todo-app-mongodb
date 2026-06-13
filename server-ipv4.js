require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Groq = require('groq-sdk');
const dns = require('dns');

// Force IPv4
dns.setDefaultResultOrder('ipv4first');

const app = express();

// Rest of your server code here (same as before)
// ... (copy your full server code from previous response)

// Then start with:
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});