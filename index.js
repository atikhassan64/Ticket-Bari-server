const express = require("express");
const cors = require("cors");
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;
const crypto = require("crypto");

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    return `${prefix}-${date}-${random}`;
}


// middleware
app.use(express.json());
app.use(cors());

const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: "unauthorized access" })
    }

    try {
        const idToken = token.split(" ")[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        // console.log("decoded id: ", decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: "unauthorized access" });
    }

}


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
            const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL;

            user.role = user.email === defaultAdminEmail ? "admin" : "user";
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

        // Get all users
        app.get("/users", verifyToken, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // Update user profile
        app.patch("/users/profile/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            const updatedInfo = req.body;

            if (email !== req.decoded_email) {
                return res.status(403).send({ message: "Forbidden access" });
            }
            const updateDoc = {
                $set: {
                    displayName: updatedInfo.displayName,
                    photoURL: updatedInfo.photoURL
                }
            };
            const result = await userCollection.updateOne(
                { email },
                updateDoc
            );
            res.send(result);
        });

        // Make Admin
        app.patch("/users/admin/:id", verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role: "admin" } }
            );

            res.send(result);
        });

        // Make Vendor
        app.patch("/users/vendor/:id", verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role: "vendor", status: "active" } }
            );

            res.send(result);
        });

        // Mark Vendor as Fraud
        app.patch("/users/fraud/:id", verifyToken, async (req, res) => {
            const id = req.params.id;

            const user = await userCollection.findOne({ _id: new ObjectId(id) });

            if (!user || user.role !== "vendor") {
                return res.status(400).send({ message: "Invalid vendor" });
            }

            const userUpdate = await userCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        isFraud: true,
                        status: "fraud"
                    }
                }
            );

            const ticketUpdate = await ticketsCollection.updateMany(
                { vendorEmail: user.email },
                { $set: { adminStatus: "fraud" } }
            );

            res.send({
                success: true,
                userUpdate,
                ticketUpdate
            });
        });

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
        app.post("/tickets", verifyToken, async (req, res) => {
            const tickets = req.body;
            tickets.isAdvertised = false;

            const vendor = await userCollection.findOne({
                email: tickets.vendorEmail
            });

            if (vendor?.isFraud === true) {
                return res.status(403).send({
                    message: "Fraud vendor cannot add tickets"
                });
            }

            const result = await ticketsCollection.insertOne(tickets);
            res.send(result);
        });

        // Update ticket by id
        app.patch("/tickets/:id", verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            try {
                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });

                if (!ticket) {
                    return res.status(404).send({ message: "Ticket not found" });
                }


                if (ticket.adminStatus === "rejected") {
                    return res.status(403).send({ message: "Rejected ticket cannot be updated" });
                }

                const update = {
                    $set: {
                        ...updatedData,
                        adminStatus: "pending",
                        status: "pending"
                    }
                };

                const result = await ticketsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    update
                );

                res.send({ success: true, result });

            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        // tickets get api for admin
        app.get("/tickets/admin", verifyToken, async (req, res) => {
            const query = {};
            const { email } = req.query;
            if (email) {
                query.vendorEmail = email;
            }

            const cursor = ticketsCollection.find(query).sort({ departure: -1 });
            const result = await cursor.toArray();
            res.send(result);
        });

        // tickets get api by email (LATEST FIRST)
        app.get("/tickets", async (req, res) => {
            try {
                const query = {};
                const { email } = req.query;

                if (email) {
                    query.vendorEmail = email;
                }

                query.adminStatus = "approved";

                const result = await ticketsCollection
                    .find(query)
                    .sort({ _id: -1 })
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch tickets" });
            }
        });


        // tickets get api by id
        app.get("/tickets/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            query.adminStatus = "approved";

            const result = await ticketsCollection.findOne(query);
            res.send(result)
        })

        // advertise tickets get api
        app.get("/tickets/advertise", async (req, res) => {
            try {
                const query = { adminStatus: "approved", isAdvertised: true };
                const tickets = await ticketsCollection.find(query).sort({ departure: -1 }).toArray();
                res.send(tickets);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // PATCH /tickets/advertise/:id
        app.patch("/tickets/advertise/:id", verifyToken, async (req, res) => {
            const ticketId = req.params.id;
            const { isAdvertised } = req.body;

            const email = req.decoded_email;
            const user = await userCollection.findOne({ email });

            if (user?.role !== "admin") {
                return res.status(403).send({ message: "Only admin can advertise tickets" });
            }

            const advertisedCount = await ticketsCollection.countDocuments({ isAdvertised: true });

            if (isAdvertised && advertisedCount >= 6) {
                return res.send({ success: false, message: "Maximum 6 tickets can be advertised" });
            }

            const result = await ticketsCollection.updateOne(
                { _id: new ObjectId(ticketId) },
                { $set: { isAdvertised: isAdvertised } }
            );

            res.send(result);
        });

        // tickets delete api by id
        app.delete("/tickets/:id", verifyToken, async (req, res) => {
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
        app.post("/ticket-booked", verifyToken, async (req, res) => {
            const bookedTicket = req.body;
            bookedTicket.status = "pending";
            bookedTicket.createAt = new Date();
            const result = await bookedTicketCollection.insertOne(bookedTicket);
            res.send(result)
        })

        // my booked tickets get api
        app.get("/ticket-booked", verifyToken, async (req, res) => {
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
        app.patch("/requested-bookings/:id/accept", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;

                const booking = await bookedTicketCollection.findOne({ _id: new ObjectId(id) });
                if (!booking) return res.status(404).send({ message: "Booking not found" });

                if (booking.vendorEmail !== req.decoded_email)
                    return res.status(403).send({ message: "Forbidden access" });

                if (booking.status === "accepted")
                    return res.send({ message: "Already accepted" });

                const ticket = await ticketsCollection.findOne({ _id: new ObjectId(booking.ticketId) });
                if (!ticket) return res.status(404).send({ message: "Ticket not found" });

                if (ticket.quantity < booking.bookingQty)
                    return res.status(400).send({ message: "Not enough tickets available" });

                await ticketsCollection.updateOne(
                    { _id: ticket._id },
                    { $inc: { quantity: -booking.bookingQty } }
                );

                const result = await bookedTicketCollection.updateOne(
                    { _id: booking._id },
                    { $set: { status: "accepted" } }
                );

                res.send({ success: true, result });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // Reject booking
        app.patch("/requested-bookings/:id/reject", verifyToken, async (req, res) => {
            try {
                const id = req.params.id;

                const booking = await bookedTicketCollection.findOne({ _id: new ObjectId(id) });
                if (!booking) return res.status(404).send({ message: "Booking not found" });

                if (booking.vendorEmail !== req.decoded_email)
                    return res.status(403).send({ message: "Forbidden access" });

                // Increase ticket quantity back if booking was accepted before
                if (booking.status === "accepted") {
                    const ticket = await ticketsCollection.findOne({ _id: new ObjectId(booking.ticketId) });
                    if (ticket) {
                        await ticketsCollection.updateOne(
                            { _id: ticket._id },
                            { $inc: { quantity: booking.bookingQty } }
                        );
                    }
                }

                const result = await bookedTicketCollection.updateOne(
                    { _id: booking._id },
                    { $set: { status: "rejected" } }
                );

                res.send({ success: true, result });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // payment related api 
        app.post("/payment", async (req, res) => {
            const paymentInfo = req.body;
            const amount = Math.round(parseFloat(paymentInfo.totalPrice) * 100);
            const quantity = parseInt(paymentInfo.bookingQty);

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
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
        app.patch("/payment-success", async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            if (session.payment_status !== "paid") {
                return res.send({ success: false });
            }

            const ticketId = session.metadata.ticketId;
            const transactionId = session.payment_intent;

            const trackingId = generateTrackingId();

            const updateResult = await bookedTicketCollection.updateOne(
                {
                    _id: new ObjectId(ticketId),
                    status: { $ne: "paid" }
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
        app.get("/payments", verifyToken, async (req, res) => {
            const email = req.query.email;
            const query = {}

            if (email) {
                query.customerEmail = email;
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: "forbidden access" })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        // Admin related api
        // ticket approve relate api
        app.patch("/tickets/approved/:id", verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await ticketsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        adminStatus: "approved"
                    }
                }
            );

            res.send(result);
        });

        // tickets reject related api
        app.patch("/tickets/rejected/:id", verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await ticketsCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        adminStatus: "rejected"
                    }
                }
            );

            res.send(result);
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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
    // console.log(`Ticket Bari is running Port ${port}`)
})