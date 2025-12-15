const express = require("express");
const cors = require("cors");
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

const crypto = require("crypto");

function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    return `${prefix}-${date}-${random}`;
}


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
        const paymentCollection = db.collection("payments");

        // user post related Api
        app.post("/users", async (req, res) => {
            const user = req.body;
            user.role = "user";
            user.createAt = new Date();
            user.isFraud = false;
            const email = user.email;
            const userExists = await userCollection.findOne({ email });
            if (userExists) {
                return res.send({ message: "user exists" })
            }

            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // user get related api
        app.get("/users/:email", async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }

            res.send(user);
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
        app.get("/ticket-booked", async (req, res) => {
            const query = {}
            const { email } = req.query;
            if (email) {
                query.userEmail = email;
            }
            const cursor = bookedTicketCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        // Accept booking
        app.patch("/requested-bookings/:id/accept", async (req, res) => {
            const id = req.params.id;
            const result = await bookedTicketCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "accepted" } }
            );
            // Optionally update bookedTicketCollection too
            const requested = await bookedTicketCollection.findOne({ _id: new ObjectId(id) });
            await bookedTicketCollection.updateOne(
                { _id: new ObjectId(requested.ticketId) },
                { $set: { status: "accepted" } }
            );
            res.send(result);
        });

        // Reject booking
        app.patch("/requested-bookings/:id/reject", async (req, res) => {
            const id = req.params.id;
            const result = await bookedTicketCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "rejected" } }
            );
            const requested = await bookedTicketCollection.findOne({ _id: new ObjectId(id) });
            await bookedTicketCollection.updateOne(
                { _id: new ObjectId(requested.ticketId) },
                { $set: { status: "rejected" } }
            );
            res.send(result);
        });


        // payment related api 
        app.post("/payment", async (req, res) => {
            const paymentInfo = req.body;
            // const amount = parseInt(paymentInfo.totalPrice);
            // const amount = Math.round(parseFloat(paymentInfo.totalPrice));
            const amount = Math.round(parseFloat(paymentInfo.totalPrice) * 100);
            const quantity = parseInt(paymentInfo.bookingQty);

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
                            currency: "usd",
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.ticketTitle
                            }
                        },
                        quantity: quantity,
                    },
                ],
                customer_email: paymentInfo.userEmail,
                mode: 'payment',
                metadata: {
                    ticketId: paymentInfo.ticketId,
                    ticketTitle: paymentInfo.ticketTitle
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })

            res.send({ url: session.url })
        })

        // payment success 
        // app.patch("/payment-success", async (req, res) => {
        //     const sessionId = req.query.session_id;
        //     const session = await stripe.checkout.sessions.retrieve(sessionId);
        //     // console.log("session retrieve : ", session);

        //     const transactionId = session.payment_intent;
        //     const query = { transactionId: transactionId }
        //     const paymentExist = await paymentCollection.findOne(query);
        //     if (paymentExist) {
        //         return res.send({
        //             message: "already exist",
        //             transactionId: transactionId,
        //             trackingId: paymentExist.trackingId
        //         })
        //     }

        //     const trackingId = generateTrackingId();

        //     if (session.payment_status === "paid") {
        //         const id = session.metadata.ticketId;
        //         const query = { _id: new ObjectId(id) };
        //         const update = {
        //             $set: {
        //                 status: "paid",
        //                 trackingId: trackingId
        //             }
        //         }
        //         const result = await bookedTicketCollection.updateOne(query, update);

        //         const payment = {
        //             amount: session.amount_total / 100,
        //             currency: session.currency,
        //             customerEmail: session.customer_email,
        //             ticketId: session.metadata.ticketId,
        //             ticketTitle: session.metadata.ticketTitle,
        //             transactionId: session.payment_intent,
        //             paymentStatus: session.payment_status,
        //             paidAt: new Date(),
        //             trackingId: trackingId
        //         }

        //         if (session.payment_status === "paid") {
        //             const resultPayment = await paymentCollection.insertOne(payment);
        //             res.send({
        //                 success: true,
        //                 modifyTicket: result,
        //                 trackingId: trackingId,
        //                 transactionId: session.payment_intent,
        //                 paymentInfo: resultPayment
        //             })
        //         }


        //     }

        //     return res.send({ success: false })
        // })

        app.patch("/payment-success", async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status !== "paid") {
                return res.send({ success: false });
            }

            const ticketId = session.metadata.ticketId;
            const transactionId = session.payment_intent;

            const trackingId = generateTrackingId();

            // ✅ ATOMIC update (ONLY if not already paid)
            const updateResult = await bookedTicketCollection.updateOne(
                {
                    _id: new ObjectId(ticketId),
                    status: { $ne: "paid" }   // 🔥 KEY LINE
                },
                {
                    $set: {
                        status: "paid",
                        trackingId: trackingId
                    }
                }
            );

            if (updateResult.matchedCount === 0) {
                const existingPayment = await paymentCollection.findOne({ transactionId });
                return res.send({
                    message: "already processed",
                    transactionId,
                    trackingId: existingPayment?.trackingId
                });
            }

            await paymentCollection.insertOne({
                amount: session.amount_total / 100,
                currency: session.currency,
                customerEmail: session.customer_email,
                ticketId: ticketId,
                ticketTitle: session.metadata.ticketTitle,
                transactionId: transactionId,
                paymentStatus: session.payment_status,
                paidAt: new Date(),
                trackingId: trackingId
            });

            res.send({
                success: true,
                transactionId,
                trackingId
            });
        });


        // payment get related api
        app.get("/payments", async (req, res) => {
            const email = req.query.email;
            const query = {}
            if (email) {
                query.customerEmail = email
            }
            const cursor = paymentCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })


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