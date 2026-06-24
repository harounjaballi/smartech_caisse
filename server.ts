import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";

// Load Firebase config
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));

// Initialize Firebase Admin
const adminApp = initializeApp({
  projectId: firebaseConfig.projectId
});
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(bodyParser.json());

  // API endpoints for User Administration (syncing with Firebase Auth + Firestore)
  app.post("/api/admin/users/create", async (req, res) => {
    try {
      const { email, password, role, allowedMenus } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email et mot de passe requis." });
      }

      const targetRole = role || "user";
      let sanitizedMenus = allowedMenus || [];
      if (targetRole !== "admin") {
        sanitizedMenus = sanitizedMenus.filter((m: string) => m !== "users" && m !== "settings");
      }

      // 1. Create the user in Firebase Auth
      const userRecord = await adminAuth.createUser({
        email,
        password,
      });

      // 2. Create the document in Firestore
      await adminDb.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        email,
        password, // Clartext password so the admin can display and view user credentials easily
        role: targetRole,
        status: "active",
        allowedMenus: sanitizedMenus,
        ownerId: userRecord.uid
      });

      res.json({ success: true, user: userRecord });
    } catch (err: any) {
      console.error("Error creating user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users/update", async (req, res) => {
    try {
      const { uid, email, password, role, allowedMenus, status } = req.body;
      if (!uid) {
        return res.status(400).json({ error: "UID requis." });
      }

      // Fetch existing user from Firestore to determine their final role if not provided in request body
      let finalRole = role;
      let existingMenus = [];
      const userRef = adminDb.collection("users").doc(uid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (!finalRole) {
          finalRole = userData?.role || "user";
        }
        existingMenus = userData?.allowedMenus || [];
      }

      // Update in Firebase Auth
      const authUpdates: any = {};
      if (email) authUpdates.email = email;
      if (password) authUpdates.password = password;

      if (Object.keys(authUpdates).length > 0) {
        await adminAuth.updateUser(uid, authUpdates);
      }

      // Update in Firestore
      const firestoreUpdates: any = {};
      if (email) firestoreUpdates.email = email;
      if (password) firestoreUpdates.password = password;
      if (role) firestoreUpdates.role = role;
      
      if (allowedMenus) {
        let sanitizedMenus = allowedMenus;
        if (finalRole !== "admin") {
          sanitizedMenus = sanitizedMenus.filter((m: string) => m !== "users" && m !== "settings");
        }
        firestoreUpdates.allowedMenus = sanitizedMenus;
      } else if (role && finalRole !== "admin") {
        // If role changed to non-admin but menus were not passed, filter original ones
        firestoreUpdates.allowedMenus = existingMenus.filter((m: string) => m !== "users" && m !== "settings");
      }
      
      if (status) firestoreUpdates.status = status;

      await userRef.update(firestoreUpdates);

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users/delete", async (req, res) => {
    try {
      const { uid } = req.body;
      if (!uid) {
        return res.status(400).json({ error: "UID requis." });
      }

      // Delete from Auth
      try {
        await adminAuth.deleteUser(uid);
      } catch (authErr) {
        console.warn("Auth user might not exist or already deleted:", authErr);
      }

      // Delete from Firestore
      await adminDb.collection("users").doc(uid).delete();

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error deleting user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // API Route to generate PDF
  app.post("/api/invoices/pdf", (req, res) => {
    const invoice = req.body;
    
    const doc = new PDFDocument({ size: [226, 600], margin: 10 }); // Thermal printer size (approx 80mm)
    
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=facture-${invoice.number}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(14).text("AgriPOS", { align: "center" });
    doc.fontSize(8).text("Magasin Agricole", { align: "center" });
    doc.text("Tunisie", { align: "center" });
    doc.moveDown();
    
    doc.fontSize(10).text(`FACTURE: ${invoice.number}`, { align: "center" });
    doc.fontSize(8).text(`Date: ${invoice.date}`, { align: "center" });
    doc.moveDown();

    // Client Info
    doc.text(`Client: ${invoice.clientName}`);
    if (invoice.clientCode) doc.text(`Code Client: ${invoice.clientCode}`);
    if (invoice.clientPhone) doc.text(`Tel: ${invoice.clientPhone}`);
    if (invoice.clientAddress) doc.text(`Adresse: ${invoice.clientAddress}`);
    doc.moveDown();

    // Table Header
    doc.text("------------------------------------------");
    doc.text("Produit          Qté   Prix   Total");
    doc.text("------------------------------------------");

    // Items
    invoice.items.forEach((item: any) => {
      const name = item.name.substring(0, 15).padEnd(16);
      const qty = item.quantity.toString().padStart(3);
      const price = item.price.toFixed(2).padStart(7);
      const total = item.total.toFixed(2).padStart(7);
      doc.text(`${name} ${qty} ${price} ${total}`);
    });

    doc.text("------------------------------------------");
    doc.moveDown();

    // Totals
    const subtotal = invoice.total - invoice.tva;
    if (invoice.tva > 0) {
      doc.fontSize(10).text(`Sous-total: ${subtotal.toFixed(2)} DT`, { align: "right" });
      doc.fontSize(10).text(`TVA: ${invoice.tva.toFixed(2)} DT`, { align: "right" });
    }
    doc.fontSize(12).font("Helvetica-Bold").text(`TOTAL GENERAL: ${invoice.total.toFixed(2)} DT`, { align: "right" });
    doc.fontSize(10).font("Helvetica").text(`Payé: ${invoice.paid.toFixed(2)} DT`, { align: "right" });
    if (invoice.debt > 0) {
      doc.fillColor("red").text(`Reste (Dette): ${invoice.debt.toFixed(2)} DT`, { align: "right" });
    }

    doc.moveDown();
    doc.fontSize(8).text("Merci de votre confiance !", { align: "center" });

    doc.end();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
