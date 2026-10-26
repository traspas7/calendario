// =============================================================
// config.js — Configuración que TÚ tienes que rellenar
// =============================================================
// Es el único archivo que necesitas tocar para conectar la web
// con tu proyecto de Supabase (mira el README, paso 4).
//
// Si dejas SUPABASE_URL o SUPABASE_ANON_KEY vacíos, la web
// funciona en "modo local": guarda todo solo en este navegador
// (útil para probarla antes de configurar Supabase).
// =============================================================

export const CONFIG = {
  // URL del proyecto: Supabase → Project Settings → API → Project URL
  SUPABASE_URL: 'https://dvkpjgnlpnvtcevrtdiu.supabase.co',

  // Clave pública: Supabase → Project Settings → API Keys → "anon public"
  // (o la "Publishable key"). ¡NUNCA pongas aquí la "service_role"/"secret"!
  SUPABASE_ANON_KEY: 'sb_publishable_h16zl4eWwdLz5mOedxT0_g_f-s0ch1g',

  // Nombre de cada uno tal y como aparece en la planilla mensual.
  // El importador de fotos busca esta fila en el texto reconocido.
  // Se dejan vacíos para que no queden públicos en GitHub: se escriben
  // la primera vez en la pantalla "Subir foto de horario" y cada móvil
  // los recuerda.
  NOMBRES_PLANILLA: {
    dani: '',
    eva: '',
  },

  // Cada cuántos segundos se buscan cambios del otro (también al volver a la app)
  REFRESCO_SEGUNDOS: 60,
};
