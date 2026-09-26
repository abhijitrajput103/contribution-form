import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { MongoClient } from "mongodb";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "freshers_party_2026";
const client = mongoUri ? new MongoClient(mongoUri) : null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const activeTokens = new Set();

app.use(cors());
app.use(express.json({limit: "20kb"}));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.json({status: "ok"}));
app.use(express.static(__dirname));

function collection(){
  if(!client) throw new Error("MONGODB_URI is not configured");
  return client.db(databaseName).collection("acknowledgements");
}

function users(){
  if(!client) throw new Error("MONGODB_URI is not configured");
  return client.db(databaseName).collection("users");
}

function requireAuth(req, res, next){
  const token = req.headers.authorization?.replace("Bearer ", "");
  if(!token || !activeTokens.has(token)) return res.status(401).json({error: "Authentication required"});
  next();
}

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  try{
    const user = await users().findOne({username});
    if(!user || !(await bcrypt.compare(password, user.passwordHash))){
      return res.status(401).json({error: "Invalid credentials"});
    }
    const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    activeTokens.add(token);
    res.json({token});
  }catch(error){
    console.error(error.message);
    res.status(503).json({error: "Database is unavailable"});
  }
});

app.get("/api/acknowledgements", requireAuth, async (req, res) => {
  try{
    const records = await collection().find({}, {projection: {_id: 0}}).sort({createdAt: -1}).toArray();
    res.json(records);
  }catch(error){
    console.error(error.message);
    res.status(503).json({error: "Database is unavailable"});
  }
});

app.post("/api/acknowledgements", requireAuth, async (req, res) => {
  const required = ["name", "roll", "amount", "handedTo", "attendance", "refId", "date"];
  if(required.some(field => !String(req.body[field] || "").trim())){
    return res.status(400).json({error: "Missing acknowledgement fields"});
  }

  try{
    const record = {
      name: String(req.body.name).trim(),
      roll: String(req.body.roll).trim(),
      amount: String(req.body.amount).trim(),
      handedTo: String(req.body.handedTo).trim(),
      attendance: String(req.body.attendance).trim(),
      refId: String(req.body.refId).trim(),
      date: String(req.body.date).trim(),
      createdAt: new Date()
    };
    await collection().insertOne(record);
    res.status(201).json({...record, _id: undefined});
  }catch(error){
    console.error(error.message);
    res.status(503).json({error: "Database is unavailable"});
  }
});

async function start(){
  if(!client) console.warn("MONGODB_URI is missing; API requests will fail until it is configured.");
  else {
    await client.connect();
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if(!username || !password) throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required");
    const passwordHash = await bcrypt.hash(password, 12);
    await users().updateOne({username}, {$setOnInsert: {username, passwordHash, createdAt: new Date()}}, {upsert: true});
  }
  app.listen(port, () => console.log(`Freshers Party form running at http://localhost:${port}`));
}

start().catch(error => {
  console.error("Could not start server:", error.message);
  process.exit(1);
});