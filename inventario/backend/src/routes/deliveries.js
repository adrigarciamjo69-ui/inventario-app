const router = require("express").Router();
const { pool } = require("../db");
const { authenticate, requireEditor } = require("../middleware/auth");

router.get("/unassigned-assets", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (drd.asset_id, dr.client_user_id)
        dr.id AS delivery_id, dr.doc_id, dr.client_user_id, dr.delivery_date,
        cu.first_name, cu.last_name,
        a.id AS asset_id, a.serial_number,
        COALESCE(a.brand,'') AS brand, COALESCE(a.model,'') AS model, a.category,
        COALESCE(cat.label, a.category) AS category_label,
        COALESCE(cat.icon,'') AS category_icon
      FROM delivery_records dr
      JOIN delivery_record_devices drd ON drd.delivery_record_id = dr.id
      JOIN assets a ON a.id = drd.asset_id
      LEFT JOIN client_users cu ON cu.id = dr.client_user_id
      LEFT JOIN categories cat ON cat.value = a.category
      WHERE dr.type = 'entrega' AND dr.status = 'entregado'
        AND drd.asset_id IS NOT NULL AND dr.client_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM asset_user_links aul
          WHERE aul.asset_id = drd.asset_id AND aul.client_user_id = dr.client_user_id
        )
      ORDER BY drd.asset_id, dr.client_user_id, dr.delivery_date DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error" });
  }
});

router.post("/assign-asset", authenticate, requireEditor, async (req, res) => {
  const { asset_id, client_user_id } = req.body;
  try {
    await pool.query("INSERT INTO asset_user_links (asset_id, client_user_id, link_type, assigned_at) VALUES ($1, $2, 'asignado', NOW()) ON CONFLICT DO NOTHING", [asset_id, client_user_id]);
    res.json({ message: "Activo asignado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error" });
  }
});

router.get("/", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT dr.*, cu.first_name, cu.last_name, cu.department, cu.employee_id, u.full_name AS created_by_name, (SELECT json_agg(json_build_object('id',drd.id,'asset_id',drd.asset_id,'device_type',drd.device_type,'model',drd.model,'serial_number',drd.serial_number,'observations',drd.observations) ORDER BY drd.id) FROM delivery_record_devices drd WHERE drd.delivery_record_id=dr.id) AS devices FROM delivery_records dr LEFT JOIN client_users cu ON cu.id=dr.client_user_id LEFT JOIN users u ON u.id=dr.created_by ORDER BY dr.delivery_date DESC, dr.created_at DESC`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Error" }); }
});

router.get("/:id", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT dr.*, cu.first_name, cu.last_name, cu.department, u.full_name AS created_by_name, (SELECT json_agg(json_build_object('id',drd.id,'asset_id',drd.asset_id,'device_type',drd.device_type,'model',drd.model,'serial_number',drd.serial_number,'observations',drd.observations)) FROM delivery_record_devices drd WHERE drd.delivery_record_id=dr.id) AS devices FROM delivery_records dr LEFT JOIN client_users cu ON cu.id=dr.client_user_id LEFT JOIN users u ON u.id=dr.created_by WHERE dr.id=$1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: "Error" }); }
});

router.post("/", authenticate, requireEditor, async (req, res) => {
  const { type, client_user_id, recipient_name, recipient_dni, delivery_date, responsible, notes, status, devices = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const docId = "DOC-" + Date.now().toString(36).toUpperCase().slice(-6);
    const { rows } = await client.query("INSERT INTO delivery_records (doc_id,type,client_user_id,recipient_name,recipient_dni,delivery_date,responsible,notes,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *", [docId,type,client_user_id||null,recipient_name||null,recipient_dni||null,delivery_date,responsible||null,notes||null,status||"pendiente",req.user.id]);
    for (const dev of devices) await client.query("INSERT INTO delivery_record_devices (delivery_record_id,asset_id,device_type,model,serial_number,observations) VALUES ($1,$2,$3,$4,$5,$6)", [rows[0].id,dev.asset_id||null,dev.device_type||null,dev.model||null,dev.serial_number||null,dev.observations||null]);
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) { await client.query("ROLLBACK"); res.status(500).json({ error: "Error" }); }
  finally { client.release(); }
});

router.put("/:id", authenticate, requireEditor, async (req, res) => {
  const { status, notes, responsible } = req.body;
  try {
    const { rows } = await pool.query("UPDATE delivery_records SET status=$1,notes=$2,responsible=$3,updated_at=NOW() WHERE id=$4 RETURNING *", [status,notes||null,responsible||null,req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: "Error" }); }
});

router.delete("/:id", authenticate, requireEditor, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM delivery_records WHERE id=$1", [req.params.id]);
    res.json({ message: "Eliminado" });
  } catch (err) { res.status(500).json({ error: "Error" }); }
});

module.exports = router;
