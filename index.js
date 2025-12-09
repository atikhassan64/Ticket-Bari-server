const express = require("express");
const cors = require("cors");
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
    res.send("Welcome to Ticket Bari")
})

app.listen(port, () => {
    console.log(`Ticket Bari is running Port ${port}`)
})