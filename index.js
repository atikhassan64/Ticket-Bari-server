const express = require("express");
const cors = require("cors");
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion } = require('mongodb');

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yc6y96u.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("ticket_bari");
        const ticketsCollection = db.collection("tickets");

        // tickets post Api
        app.post("/tickets", async (req, res) => {
            const tickets = req.body;
            const result = await ticketsCollection.insertOne(tickets);
            res.send(result);
        })

        // All tickets get Api
        app.get("/tickets", async (req, res) => {
            const cursor = ticketsCollection.find({});
            const result = await cursor.toArray();
            res.send(result);
        })

        // tickets get api by id
        app.get("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const result = await ticketsCollection.findOne({ _id: new ObjectId(id) });
            res.send(result);
        });


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("Welcome to Ticket Bari")
})

app.listen(port, () => {
    console.log(`Ticket Bari is running Port ${port}`)
})