const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD.replace(/\s/g, ''),
  }
});

async function main() {
  // Buscar tareas creadas en los últimos 6 minutos (margen de seguridad sobre los 5 min del cron)
  const since = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  const { data: tareas, error: tError } = await db
    .from('tf_tasks')
    .select('*')
    .gte('created_at', since);

  if (tError) { console.error('Error consultando tareas:', tError.message); process.exit(1); }
  if (!tareas || tareas.length === 0) { console.log('Sin tareas nuevas en los últimos 6 minutos.'); return; }

  // Cargar todos los usuarios
  const { data: usuarios, error: uError } = await db.from('tf_users').select('*');
  if (uError) { console.error('Error consultando usuarios:', uError.message); process.exit(1); }

  for (const tarea of tareas) {
    const assignees = tarea.assignees || [];
    if (assignees.length === 0) { console.log(`Tarea "${tarea.title}" sin asignados, omitiendo.`); continue; }

    const creador = usuarios.find(u => u.id === tarea.created_by);
    const nombreCreador = creador ? creador.name : 'Alguien';

    for (const userId of assignees) {
      const asignado = usuarios.find(u => u.id === userId);
      if (!asignado || !asignado.email) { console.log(`Usuario ${userId} sin email, omitiendo.`); continue; }

      const asunto = `Nueva tarea asignada: ${tarea.title}`;
      const vencimiento = tarea.due_date && tarea.due_date !== '—'
        ? tarea.due_date.split('-').reverse().join('/')
        : 'Sin fecha límite';

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f5f4f0;border-radius:12px">
          <div style="background:#ffffff;border-radius:10px;padding:28px;border:1px solid #e2e0d8">
            <div style="margin-bottom:20px">
              <span style="font-size:20px;font-weight:700;letter-spacing:-.5px">Task<span style="color:#4f46e5">Flow</span></span>
              <span style="font-size:14px;font-weight:600;color:#1a3a8f;font-style:italic"> Auto</span><span style="font-size:14px;font-weight:600;color:#29abe2;font-style:italic">Fácil</span>
            </div>
            <p style="font-size:15px;color:#1a1916;margin-bottom:6px">Hola <strong>${asignado.name}</strong>,</p>
            <p style="font-size:14px;color:#6b6860;margin-bottom:20px">
              <strong>${nombreCreador}</strong> te ha asignado la siguiente tarea:
            </p>
            <div style="background:#eeedfd;border-left:4px solid #4f46e5;border-radius:8px;padding:16px 20px;margin-bottom:20px">
              <div style="font-size:16px;font-weight:600;color:#1a1916;margin-bottom:8px">${tarea.title}</div>
              ${tarea.description ? `<div style="font-size:13px;color:#6b6860;margin-bottom:10px">${tarea.description}</div>` : ''}
              <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
                <span style="font-size:12px;background:#fff;border-radius:20px;padding:3px 10px;color:#3730a3;border:1px solid #a5b4fc">
                  📌 ${tarea.priority || 'Media'}
                </span>
                <span style="font-size:12px;background:#fff;border-radius:20px;padding:3px 10px;color:#6b6860;border:1px solid #e2e0d8">
                  📅 Vence: ${vencimiento}
                </span>
              </div>
            </div>
            <a href="https://reportes-ai.github.io/TaskFlow/" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500">
              Ver tarea en TaskFlow →
            </a>
            <p style="font-size:11px;color:#9e9b93;margin-top:24px;margin-bottom:0">
              Este correo fue enviado automáticamente por TaskFlow · AutoFácil
            </p>
          </div>
        </div>`;

      try {
        await transporter.sendMail({
          from: `"TaskFlow AutoFácil" <${process.env.GMAIL_USER}>`,
          to: asignado.email,
          subject: asunto,
          html,
        });
        console.log(`✓ Email enviado a ${asignado.name} (${asignado.email}) — Tarea: ${tarea.title}`);
      } catch (err) {
        console.error(`✗ Error enviando a ${asignado.email}:`, err.message);
      }
    }
  }
}

main().catch(err => { console.error('Error general:', err); process.exit(1); });
