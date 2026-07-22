const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sbGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Estados que se incluyen en el reporte
const ESTADOS_INCLUIDOS = ['Pendiente', 'En progreso', 'En revisión'];

function diasDesde(fechaISO) {
  if (!fechaISO) return '-';
  const creada = new Date(fechaISO);
  const hoy = new Date();
  const diff = hoy - creada;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function fmtFecha(fechaISO) {
  if (!fechaISO) return '-';
  const d = new Date(fechaISO);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function colorEstado(estado) {
  if (estado === 'Pendiente') return { bg: '#FFF3E0', color: '#E65100' };
  if (estado === 'En progreso') return { bg: '#E3F2FD', color: '#1565C0' };
  if (estado === 'En revisión') return { bg: '#F3E5F5', color: '#6A1B9A' };
  return { bg: '#ECEFF1', color: '#546E7A' };
}

function colorPrioridad(prioridad) {
  const p = (prioridad || '').toLowerCase();
  if (p.includes('alta') || p.includes('urgente')) return '#C62828';
  if (p.includes('media')) return '#E65100';
  return '#2E7D32';
}

async function main() {
  console.log('Obteniendo datos...');
  const usuarios = await sbGet('tf_users', 'order=name.asc');
  const tareas = await sbGet('tf_tasks', 'order=created_at.asc');

  // Filtrar solo tareas en los estados incluidos
  const tareasActivas = tareas.filter(t => ESTADOS_INCLUIDOS.includes(t.status));

  const hoy = new Date();
  const fechaHoy = hoy.toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASSWORD.replace(/\s/g, ''),
    }
  });

  let enviados = 0;

  for (const usuario of usuarios) {
    if (!usuario.email) continue;

    // Tareas asignadas a este usuario en los estados incluidos
    const misTareas = tareasActivas.filter(t =>
      Array.isArray(t.assignees) && t.assignees.includes(usuario.id)
    );

    if (misTareas.length === 0) continue; // No enviar si no tiene tareas activas

    // Ordenar por antigüedad (más antiguas primero)
    misTareas.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // Agrupar por estado
    const porEstado = {};
    ESTADOS_INCLUIDOS.forEach(e => porEstado[e] = []);
    misTareas.forEach(t => porEstado[t.status].push(t));

    // Construir tablas por estado
    let tablasHTML = '';
    ESTADOS_INCLUIDOS.forEach(estado => {
      const tareasEstado = porEstado[estado];
      if (tareasEstado.length === 0) return;
      const col = colorEstado(estado);

      const filas = tareasEstado.map(t => {
        const dias = diasDesde(t.created_at);
        const diasTexto = dias === 0 ? 'Hoy' : dias === 1 ? '1 día' : `${dias} días`;
        const diasColor = dias >= 14 ? '#C62828' : dias >= 7 ? '#E65100' : '#546E7A';
        return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #ECEFF1;font-weight:600;color:#263238">${t.title || 'Sin título'}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #ECEFF1;text-align:center">
              <span style="background:${colorPrioridad(t.priority)}20;color:${colorPrioridad(t.priority)};padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600">${t.priority || '-'}</span>
            </td>
            <td style="padding:8px 12px;border-bottom:1px solid #ECEFF1;text-align:center;color:#546E7A;font-size:13px">${fmtFecha(t.created_at)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #ECEFF1;text-align:center;font-weight:600;color:${diasColor}">${diasTexto}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #ECEFF1;text-align:center;color:#546E7A;font-size:13px">${fmtFecha(t.due_date)}</td>
          </tr>`;
      }).join('');

      tablasHTML += `
        <div style="margin-bottom:24px">
          <h3 style="color:${col.color};font-size:15px;margin:0 0 8px;display:flex;align-items:center;gap:8px">
            <span style="background:${col.bg};color:${col.color};padding:3px 12px;border-radius:12px;font-size:13px">${estado}</span>
            <span style="color:#90A4AE;font-size:13px;font-weight:400">${tareasEstado.length} tarea(s)</span>
          </h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="background:${col.color}">
                <th style="padding:8px 12px;text-align:left;color:#fff;font-size:12px">Tarea</th>
                <th style="padding:8px 12px;text-align:center;color:#fff;font-size:12px">Prioridad</th>
                <th style="padding:8px 12px;text-align:center;color:#fff;font-size:12px">Creada</th>
                <th style="padding:8px 12px;text-align:center;color:#fff;font-size:12px">Antigüedad</th>
                <th style="padding:8px 12px;text-align:center;color:#fff;font-size:12px">Vence</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>`;
    });

    const primerNombre = (usuario.name || '').split(' ')[0];

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff;padding:24px;border-radius:8px 8px 0 0">
          <h1 style="margin:0;font-size:20px">📋 TaskFlow — Tus tareas pendientes</h1>
          <p style="margin:6px 0 0;opacity:0.9;font-size:14px">Hola ${primerNombre}, este es tu resumen del ${fechaHoy}</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #E0E0E0;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#546E7A;font-size:14px;margin:0 0 20px">
            Tienes <strong style="color:#1565C0">${misTareas.length} tarea(s)</strong> activa(s) que requieren tu atención:
          </p>
          ${tablasHTML}
          <p style="color:#90A4AE;font-size:12px;margin-top:24px;border-top:1px solid #ECEFF1;padding-top:16px">
            Este es un recordatorio automático de TaskFlow. Ingresa a la plataforma para actualizar el estado de tus tareas.
          </p>
        </div>
      </div>`;

    try {
      await transporter.sendMail({
        from: `"TaskFlow" <${process.env.GMAIL_USER}>`,
        to: usuario.email,
        subject: `📋 Tienes ${misTareas.length} tarea(s) pendiente(s) — ${hoy.toLocaleDateString('es-CL')}`,
        html,
      });
      console.log(`✅ Enviado a ${usuario.name} (${usuario.email}) — ${misTareas.length} tareas`);
      enviados++;
    } catch (err) {
      console.error(`❌ Error enviando a ${usuario.email}:`, err.message);
    }
  }

  console.log(`\nTotal correos enviados: ${enviados}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
