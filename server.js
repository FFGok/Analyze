const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// public klasörünü yayınla
app.use(express.static(path.join(__dirname, "public")));

// Ana sayfa
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Analyze running on port ${PORT}`);
});
