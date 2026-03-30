const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ----------------------
// MODELLAR
// ----------------------
const driverSchema = new mongoose.Schema({
  driverIdCustom: String,
  login: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  driverName: String,
  carModel: String,
  carNumber: String,
  phone: String,
  region: String,
  tariff: { type: String, default: "Standart" },
  isOnline: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },
  subscriptionUntil: {
    type: Date,
    default: () => new Date(+new Date() + 30 * 24 * 60 * 60 * 1000),
  },
  currentLocation: {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
  },
  lastOrderAt: { type: Date, default: null },
  statistics: {
    balls: { type: Number, default: 0 },
    todayEarned: { type: Number, default: 0 },
    totalTrips: { type: Number, default: 0 },
  },
});

const customerSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,
  balls: { type: Number, default: 0 },
});

const settingsSchema = new mongoose.Schema({
  baseFare: { type: Number, default: 5000 },
  pricePerKm: { type: Number, default: 2000 },
  minDist: { type: Number, default: 2 },
  waitPrice: { type: Number, default: 500 },
});

const Driver = mongoose.model("Driver", driverSchema);
const Customer = mongoose.model("Customer", customerSchema);
const Settings = mongoose.model("Settings", settingsSchema);

async function generateDriverCustomId() {
  const lastDriver = await Driver.findOne({
    driverIdCustom: { $regex: /^DRV-\d+$/ }
  }).sort({ driverIdCustom: -1 });

  let nextNumber = 1;

  if (lastDriver && lastDriver.driverIdCustom) {
    const parts = lastDriver.driverIdCustom.split("-");
    const lastNumber = parseInt(parts[1], 10);

    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  return `DRV-${String(nextNumber).padStart(3, "0")}`;
}

// ----------------------
// DATABASE
// ----------------------
mongoose
  mongoose
  .connect("mongodb+srv://arlistunner_db_user:ipp4K0HP1SuMz6N6@eltaxi.rfxddqh.mongodb.net/eltaxi_db?retryWrites=true&w=majority&appName=ELtaxi")
  .then(async () => {
    console.log("MongoDB ulandi ✅");
    if ((await Settings.countDocuments()) === 0) {
      await Settings.create({});
    }
  })
  .catch((err) => console.log("Mongo xato:", err));

// ----------------------
// EXPRESS SETTINGS
// ----------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "eltaxi_secret_2026",
    resave: false,
    saveUninitialized: true,
  })
);

// ----------------------
// ROUTES
// ----------------------
app.get("/", (req, res) => res.render("index"));

// ----------------------
// MIJOZ
// ----------------------
app.get("/mijoz", async (req, res) => {
  const customer = req.session.customerId
    ? await Customer.findById(req.session.customerId)
    : null;

  res.render("mijoz", {
    customer: customer || { name: "", balls: 0 },
  });
});

app.post("/auth-mijoz", async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.redirect("/mijoz");

  const customer = await Customer.findOneAndUpdate(
    { phone },
    { name },
    { upsert: true, returnDocument: "after" }
  );

  req.session.customerId = customer._id;
  res.redirect("/pwa-install");
});

app.get("/pwa-install", async (req, res) => {
  if (!req.session.customerId) return res.redirect("/mijoz");
  res.render("pwa-install");
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.customerId) return res.redirect("/mijoz");

  const customer = await Customer.findById(req.session.customerId);
  const settings = await Settings.findOne();
  const onlineDrivers = await Driver.find({ isOnline: true, isBlocked: false });
  const availableCars = [...new Set(onlineDrivers.map((d) => d.carModel))];

  res.render("dashboard", { customer, availableCars, settings });
});

// ----------------------
// DRIVER LOGIN (XAYDOVCHI KIRISHI)
// ----------------------
app.get("/login", (req, res) => res.render("login"));

app.post("/driver-auth", async (req, res) => {
  const { login, password } = req.body;
  const driver = await Driver.findOne({ login, password });
  if (!driver) return res.send("Login yoki parol xato");
  if (driver.isBlocked) return res.send("Profil bloklangan");

  req.session.driverId = driver._id;
  res.redirect("/driver-dashboard");
});

app.get("/driver-dashboard", async (req, res) => {
    if (!req.session.driverId) return res.redirect("/login");
    
    try {
        const driver = await Driver.findById(req.session.driverId);
        const settings = await Settings.findOne(); // MUHIM: Tariflarni settingsdan olamiz

        if (!driver) return res.redirect("/login");

        const remainingDays = Math.ceil(
            (driver.subscriptionUntil - new Date()) / (1000 * 60 * 60 * 24)
        );

        res.render("driver-dashboard", {
            driver,
            settings: settings || { pricePerKm: 2000, baseFare: 5000 }, // Xato bermasligi uchun default qiymat
            remainingDays: remainingDays > 0 ? remainingDays : 0,
            queuePosition: 0,
        });
    } catch (err) {
        console.log("Dashboard xatosi:", err);
        res.redirect("/login");
    }
});

// ----------------------
// ADMIN AUTH (ADMIN KIRISHI)
// ----------------------
app.get("/el-admin-portal", (req, res) => res.render("admin-login"));

app.post("/admin-auth", (req, res) => {
  const { user, pass } = req.body;
  if (user === "sharqtech" && pass === "sharq1505") {
    req.session.adminLoggedIn = true;
    return res.redirect("/admin");
  }
  res.send("Admin login yoki paroli xato!");
});

app.get("/admin", async (req, res) => {
  if (!req.session.adminLoggedIn) return res.redirect("/el-admin-portal");
  const drivers = await Driver.find();
  const customerCount = await Customer.countDocuments();
  const onlineCount = await Driver.countDocuments({ isOnline: true });
  const totalStats = {
    total: drivers.reduce((a, d) => a + (d.statistics.todayEarned || 0), 0),
    count: drivers.reduce((a, d) => a + (d.statistics.totalTrips || 0), 0),
  };
  res.render("admin", { drivers, customerCount, onlineCount, totalStats });
});

// ----------------------
// DRIVER CREATE (XAYDOVCHI QO'SHISH)
// ----------------------
app.post("/admin/add-driver", async (req, res) => {
  const { driverName, carModel, carNumber, phone, login, password, region, tariff } = req.body;

  try {
    const newCustomId = await generateDriverCustomId();

    await Driver.create({
      driverIdCustom: newCustomId,
      login,
      password,
      driverName,
      carModel,
      carNumber,
      phone,
      region,
      tariff
    });

    res.redirect("/admin");
  } catch (error) {
    console.log("Xaydovchi qo'shishda xato:", error);
    res.send("Xatolik yuz berdi: login band bo'lishi mumkin yoki formadagi ma'lumotlar noto'g'ri.");
  }
});

// ----------------------
// ----------------------
function toRad(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
// REALTIME (Socket.io)
let onlineQueue = [];
let driverSockets = {};
let customerSockets = {};
let activeOrders = {};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // ----------------------
  // MIJOZ ONLINE
  // ----------------------
  socket.on("customer_online", (data) => {
    const customerId = String(data.customerId || "");
    if (!customerId) return;

    socket.customerId = customerId;
    customerSockets[customerId] = socket.id;

    console.log("Customer online:", customerId, socket.id);
  });

  // ----------------------
  // HAYDOVCHI ONLINE
  // ----------------------
  socket.on("driver_online", async (data) => {
  const driverId = String(data.driverId || "");
  const lat = Number(data.lat);
  const lon = Number(data.lon);

  if (!driverId) return;

  socket.driverId = driverId;
  driverSockets[driverId] = socket.id;

  const updateData = { isOnline: true };

  if (!isNaN(lat) && !isNaN(lon)) {
    updateData.currentLocation = { lat, lon };
  }

  await Driver.findByIdAndUpdate(driverId, updateData);

  if (!onlineQueue.includes(driverId)) {
    onlineQueue.push(driverId);
  }

  io.emit("queue_update", {
    driverId,
    position: onlineQueue.indexOf(driverId) + 1
  });

  console.log("Driver online:", driverId, socket.id, onlineQueue);
});

  // ----------------------
  // HAYDOVCHI OFFLINE
  // ----------------------
  socket.on("driver_offline", async (data) => {
    const driverId = String(data.driverId || "");
    if (!driverId) return;

    await Driver.findByIdAndUpdate(driverId, { isOnline: false });

    onlineQueue = onlineQueue.filter((id) => id !== driverId);
    delete driverSockets[driverId];

    console.log("Driver offline:", driverId);
  });

  // ----------------------
  // BUYURTMA YUBORISH
  // ----------------------
  socket.on("send_order", async (data) => {
  try {
    const customerId = String(data.customerId || "");
    const customerLat = Number(data.lat);
    const customerLon = Number(data.lon);
    const requestedType = String(data.type || "Standart");

    if (!customerId || isNaN(customerLat) || isNaN(customerLon)) return;

    const customer = await Customer.findById(customerId);

    let onlineDrivers = await Driver.find({
      isOnline: true,
      isBlocked: false,
      "currentLocation.lat": { $ne: null },
      "currentLocation.lon": { $ne: null }
    });

    if (!onlineDrivers.length) {
      socket.emit("no_driver_available");
      return;
    }

    const queueDrivers = onlineQueue
      .map((id) => onlineDrivers.find((d) => String(d._id) === String(id)))
      .filter(Boolean);

    if (!queueDrivers.length) {
      socket.emit("no_driver_available");
      return;
    }

    const driversWithDistance = queueDrivers.map((driver) => {
      const distanceKm = calculateDistanceKm(
        customerLat,
        customerLon,
        driver.currentLocation.lat,
        driver.currentLocation.lon
      );

      return {
        driver,
        distanceKm,
        queueIndex: onlineQueue.indexOf(String(driver._id))
      };
    });

    driversWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);

    const nearestCandidates = driversWithDistance.slice(0, 3);

    nearestCandidates.sort((a, b) => a.queueIndex - b.queueIndex);

    const selected = nearestCandidates[0];

    if (!selected) {
      socket.emit("no_driver_available");
      return;
    }

    const driverId = String(selected.driver._id);
    const driverSocketId = driverSockets[driverId];

    if (!driverSocketId) {
      socket.emit("no_driver_available");
      return;
    }

    activeOrders[customerId] = {
      customerId,
      driverId,
      status: "pending",
      createdAt: Date.now(),
      lat: customerLat,
      lon: customerLon,
      note: data.note || "",
      type: requestedType
    };

    io.to(driverSocketId).emit(`order_for_driver_${driverId}`, {
      customerId,
      clientId: customerId,
      lat: customerLat,
      lon: customerLon,
      note: data.note || "",
      type: requestedType,
      clientName: customer?.name || "Mijoz",
      phone: customer?.phone || "",
      distanceKm: selected.distanceKm
    });

    console.log("Order sent to driver:", {
      customerId,
      driverId,
      distanceKm: selected.distanceKm
    });

    setTimeout(() => {
      const order = activeOrders[customerId];
      if (!order) return;

      if (order.status === "pending" && order.driverId === driverId) {
        delete activeOrders[customerId];

        if (onlineQueue.length > 1) {
          onlineQueue.push(onlineQueue.shift());
        }

        const customerSocketId = customerSockets[customerId];
        if (customerSocketId) {
          io.to(customerSocketId).emit("order_not_accepted", { customerId });
        }

        console.log("Order timeout:", customerId);
      }
    }, 15000);
  } catch (err) {
    console.log("send_order error:", err);
  }
});

  // ----------------------
  // BUYURTMANI QABUL QILISH
  // ----------------------
  socket.on("accept_order", async (data) => {
    try {
      const driverId = String(data.driverId || "");
      const customerId = String(data.clientId || data.customerId || "");

      if (!driverId || !customerId) {
        console.log("accept_order missing ids:", data);
        return;
      }

      const driver = await Driver.findById(driverId);
      if (!driver) {
        console.log("Driver not found for accept_order:", driverId);
        return;
      }

      activeOrders[customerId] = {
        customerId,
        driverId,
        status: "accepted",
        acceptedAt: Date.now()
      };

      onlineQueue = onlineQueue.filter((id) => id !== driverId);

      const customerSocketId = customerSockets[customerId];
      console.log("accept_order => customer socket:", customerId, customerSocketId);

      if (customerSocketId) {
        io.to(customerSocketId).emit("order_accepted", {
          customerId,
          driverId,
          driverName: driver.driverName,
          carModel: driver.carModel,
          carNumber: driver.carNumber,
          phone: driver.phone
        });
      }
    } catch (err) {
      console.log("accept_order error:", err);
    }
  });

  // ----------------------
  // HAYDOVCHI KELDI
  // ----------------------
  socket.on("driver_arrived", async (data) => {
    try {
      const customerId = String(data.clientId || data.customerId || "");
      if (!customerId) return;

      const order = activeOrders[customerId];
      if (!order) {
        console.log("driver_arrived no active order:", customerId);
        return;
      }

      const driver = await Driver.findById(order.driverId);
      if (!driver) return;

      order.status = "arrived";

      const customerSocketId = customerSockets[customerId];
      console.log("driver_arrived =>", customerId, customerSocketId);

      if (customerSocketId) {
        io.to(customerSocketId).emit("driver_arrived", {
          customerId,
          driverId: order.driverId,
          driverName: driver.driverName,
          carModel: driver.carModel,
          carNumber: driver.carNumber,
          phone: driver.phone
        });
      }
    } catch (err) {
      console.log("driver_arrived error:", err);
    }
  });

  // ----------------------
  // TAKSOMETR YOQILDI
  // ----------------------
  socket.on("taximeter_on", (data) => {
    try {
      const customerId = String(data.clientId || data.customerId || "");
      if (!customerId) return;

      const order = activeOrders[customerId];
      if (!order) return;

      order.status = "in_progress";

      const customerSocketId = customerSockets[customerId];
      if (customerSocketId) {
        io.to(customerSocketId).emit("ride_started", { customerId });
      }

      console.log("ride_started:", customerId);
    } catch (err) {
      console.log("taximeter_on error:", err);
    }
  });

  // ----------------------
  // SAFAR TUGADI
  // ----------------------
  socket.on("finish_trip_and_pay", async (data) => {
  try {
    const driverId = String(data.driverId || "");
    const customerId = String(data.clientId || data.customerId || "");

    if (!driverId || !customerId) return;

    const driver = await Driver.findById(driverId);
    if (driver) {
      driver.statistics.todayEarned =
        (driver.statistics.todayEarned || 0) + Number(data.amount || 0);
      driver.statistics.totalTrips =
        (driver.statistics.totalTrips || 0) + 1;
      driver.lastOrderAt = new Date();
      driver.isOnline = true;
      await driver.save();
    }

    const customerSocketId = customerSockets[customerId];
    if (customerSocketId) {
      io.to(customerSocketId).emit("trip_finished", {
        customerId,
        driverId,
        amount: Number(data.amount || 0),
        distance: data.distance || 0
      });
    }

    delete activeOrders[customerId];

    // Haydovchini yana navbatga qaytaramiz
    if (!onlineQueue.includes(driverId)) {
      onlineQueue.push(driverId);
    }

    // Shu haydovchiga yangi navbat o‘rnini yuboramiz
    io.emit("queue_update", {
      driverId,
      position: onlineQueue.indexOf(driverId) + 1
    });

    console.log("trip_finished:", customerId, "driver returned to queue:", driverId, onlineQueue);
  } catch (err) {
    console.log("finish_trip_and_pay error:", err);
  }
});

  // ----------------------
  // BUYURTMANI E'TIBORSIZ QOLDIRISH
  // ----------------------
  socket.on("order_ignored", (data) => {
    try {
      const driverId = String(data.driverId || "");
      const customerId = String(data.clientId || data.customerId || "");

      if (!driverId || !customerId) return;

      const order = activeOrders[customerId];
      if (!order) return;

      if (order.status === "pending" && order.driverId === driverId) {
        delete activeOrders[customerId];

        if (onlineQueue.length > 1) {
          onlineQueue.push(onlineQueue.shift());
        }

        const customerSocketId = customerSockets[customerId];
        if (customerSocketId) {
          io.to(customerSocketId).emit("order_not_accepted", { customerId });
        }

        console.log("order_ignored:", customerId);
      }
    } catch (err) {
      console.log("order_ignored error:", err);
    }
  });

  // ----------------------
  // BUYURTMANI BEKOR QILISH
  // ----------------------
  socket.on("cancel_order", (data) => {
    try {
      const customerId = String(data.customerId || "");
      if (!customerId) return;

      const order = activeOrders[customerId];

      if (order) {
        const driverSocketId = driverSockets[order.driverId];
        if (driverSocketId) {
          io.to(driverSocketId).emit("order_cancelled", { customerId });
        }

        delete activeOrders[customerId];
      }

      const customerSocketId = customerSockets[customerId];
      if (customerSocketId) {
        io.to(customerSocketId).emit("order_cancelled_client", { customerId });
      }

      console.log("order_cancelled:", customerId);
    } catch (err) {
      console.log("cancel_order error:", err);
    }
  });

  // ----------------------
  // HAYDOVCHI JOYLASHUVI
  // ----------------------
  socket.on("update_location", async (data) => {
  try {
    const driverId = String(data.driverId || "");
    const lat = Number(data.lat);
    const lon = Number(data.lon);

    if (!driverId || isNaN(lat) || isNaN(lon)) return;

    await Driver.findByIdAndUpdate(driverId, {
      currentLocation: { lat, lon }
    });

    const activeCustomerId = Object.keys(activeOrders).find((customerId) => {
      return activeOrders[customerId].driverId === driverId;
    });

    if (!activeCustomerId) return;

    const customerSocketId = customerSockets[activeCustomerId];
    if (customerSocketId) {
      io.to(customerSocketId).emit("driver_location_updated", {
        driverId,
        lat,
        lon
      });
    }
  } catch (err) {
    console.log("update_location error:", err);
  }
});

  // ----------------------
  // DISCONNECT
  // ----------------------
  socket.on("disconnect", async () => {
    try {
      console.log("Socket disconnected:", socket.id);

      if (socket.driverId) {
        await Driver.findByIdAndUpdate(socket.driverId, { isOnline: false });
        onlineQueue = onlineQueue.filter((id) => id !== socket.driverId);
        delete driverSockets[socket.driverId];
      }

      if (socket.customerId) {
        delete customerSockets[socket.customerId];
      }
    } catch (err) {
      console.log("disconnect error:", err);
    }
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("ElTaxi ishlayapti 🚕"));