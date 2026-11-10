
import express from "express";
import jwt from "jsonwebtoken";
import db from "./database.js";

const router = express.Router();

// Verify login token
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      error: "Please log in to access saved analyses.",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.userId) {
      return res.status(401).json({ error: "Invalid login token." });
    }

    req.user = { id: payload.userId };
    next();
  } catch {
    return res.status(401).json({
      error: "Your session is invalid or expired. Please log in again.",
    });
  }
}

// GET: Load only this user's saved analyses
router.get("/", authenticateToken, (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT id, product_name, price, source, reviews,
               analysis_json, created_at
        FROM saved_analyses
        WHERE user_id = ?
        ORDER BY id DESC
      `)
      .all(req.user.id);

    const analyses = rows.map((row) => {
      let analysis;

      try {
        analysis = JSON.parse(row.analysis_json);
      } catch {
        analysis = null;
      }

      return {
        id: row.id,
        productName: row.product_name,
        price: row.price,
        source: row.source,
        reviews: row.reviews,
        analysis,
        createdAt: row.created_at,
      };
    });

    return res.json({ analyses });
  } catch (error) {
    console.error("Load saved analyses error:", error.message);
    return res.status(500).json({
      error: "Could not load saved analyses.",
    });
  }
});

// POST: Save a new analysis for this user
router.post("/", authenticateToken, (req, res) => {
  try {
    const {
      productName,
      price = "",
      source = "",
      reviews = "",
      analysis,
    } = req.body || {};

    if (
      typeof productName !== "string" ||
      !productName.trim() ||
      productName.length > 200
    ) {
      return res.status(400).json({
        error: "A valid product name is required.",
      });
    }

    if (
      typeof price !== "string" && typeof price !== "number" ||
      typeof source !== "string" ||
      typeof reviews !== "string" ||
      !analysis ||
      typeof analysis !== "object" ||
      Array.isArray(analysis)
    ) {
      return res.status(400).json({
        error: "Valid analysis details are required.",
      });
    }

    const result = db
      .prepare(`
        INSERT INTO saved_analyses
          (user_id, product_name, price, source, reviews, analysis_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        req.user.id,
        productName.trim(),
        String(price),
        source,
        reviews,
        JSON.stringify(analysis)
      );

    return res.status(201).json({
      message: "Analysis saved successfully.",
      id: Number(result.lastInsertRowid),
    });
  } catch (error) {
    console.error("Save analysis error:", error.message);
    return res.status(500).json({
      error: "Could not save this analysis.",
    });
  }
});

// DELETE: Delete one saved analysis owned by this user
router.delete("/:id", authenticateToken, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid analysis ID." });
  }

  try {
    const result = db
      .prepare(`
        DELETE FROM saved_analyses
        WHERE id = ? AND user_id = ?
      `)
      .run(id, req.user.id);

    if (result.changes === 0) {
      return res.status(404).json({
        error: "Saved analysis not found.",
      });
    }

    return res.json({ message: "Analysis deleted successfully." });
  } catch (error) {
    console.error("Delete analysis error:", error.message);
    return res.status(500).json({
      error: "Could not delete this analysis.",
    });
  }
});

// DELETE: Clear all saved analyses belonging to this user
router.delete("/", authenticateToken, (req, res) => {
  try {
    const result = db
      .prepare("DELETE FROM saved_analyses WHERE user_id = ?")
      .run(req.user.id);

    return res.json({
      message: "Your saved history has been cleared.",
      deletedCount: result.changes,
    });
  } catch (error) {
    console.error("Clear saved analyses error:", error.message);
    return res.status(500).json({
      error: "Could not clear saved history.",
    });
  }
});

export default router;
