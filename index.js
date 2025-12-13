const express = require("express");
const cors = require("cors");
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
        const userCollection = db.collection("users");
        const ticketsCollection = db.collection("tickets");
        const bookedTicketCollection = db.collection("bookedTickets");

        // user post related Api
        app.post("/users", async (req, res) => {
            const user = req.body;
            user.role = "user";
            user.createAt = new Date();
            const email = user.email;
            const userExists = await userCollection.findOne({ email });
            if (userExists) {
                return res.send({ message: "user exists" })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // tickets post Api
        app.post("/tickets", async (req, res) => {
            const tickets = req.body;
            const result = await ticketsCollection.insertOne(tickets);
            res.send(result);
        })

        // tickets get api by email
        app.get("/tickets", async (req, res) => {
            const query = {}
            const { email } = req.query;
            if (email) {
                query.vendorEmail = email;
            }

            const cursor = ticketsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        // tickets get api by id
        app.get("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ticketsCollection.findOne(query);
            res.send(result)
        })

        // tickets delete api by id
        app.delete("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await ticketsCollection.deleteOne(query);
            res.send(result)
        })

        // tickets update api by id
        app.patch('/transactions/:id', async (req, res) => {
            const id = req.params.id;
            const updateTransaction = req.body;
            const query = { _id: new ObjectId(id) };
            const update = {
                $set: {
                    type: updateTransaction.type,
                    category: updateTransaction.category,
                    amount: updateTransaction.amount,
                    description: updateTransaction.description,
                    date: updateTransaction.date
                }
            }
            const options = {};
            const result = await finEaseCollection.updateOne(query, update, options);
            res.send(result);
        })

        // my booked tickets post Api
        app.post("/ticket-booked", async (req, res) => {
            const bookedTicket = req.body;
            bookedTicket.status = "pending";
            bookedTicket.createAt = new Date();
            const result = await bookedTicketCollection.insertOne(bookedTicket);
            res.send(result)
        })

        // my booked tickets get api
        


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