# 📅 Calendario Dani + Eva

Calendario compartido de turnos y eventos. HTML + CSS + JavaScript sin frameworks, datos en Supabase, publicado en GitHub Pages.

---

## 1. Estructura del proyecto

```
calendario/
├── index.html            ← Estructura de la página y todas las ventanas (modales)
├── sw.js                 ← Service worker: la web abre aunque no haya internet
├── css/
│   └── styles.css        ← Diseño oscuro, mobile first
├── js/
│   ├── config.js         ← ⭐ LO ÚNICO QUE TIENES QUE RELLENAR (claves y nombres)
│   ├── app.js            ← Arranque, PIN, navegación, sincronización, avisos
│   ├── store.js          ← Datos: Supabase + caché offline en el móvil
│   ├── calendario.js     ← Dibuja la vista mes, la vista semana y el resumen
│   ├── modales.js        ← Ventana del día (turnos a mano) y del evento
│   ├── importar.js       ← Pantalla "Cargar horario" (Excel, pegar, a mano, foto) + editor del mes
│   ├── excel.js          ← Lee el cuadrante desde .xlsx o desde lo copiado de Excel
│   ├── ocr.js            ← Mejora de imagen + Tesseract.js + extracción de turnos
│   ├── turnos.js         ← Turnos M, T, N, FM, FT, FN, L, V y horarios a medida
│   └── utils.js          ← Fechas en español, avisos, utilidades
└── supabase/
    └── schema.sql        ← Tablas, función del PIN y políticas RLS
```

---

## 2. Probar en local (antes de configurar nada)

Si `js/config.js` no tiene claves, la web arranca en **modo local**: guarda todo solo en ese navegador. Sirve para ver el diseño y probarla.

1. Instala **VS Code** y, dentro, la extensión **Live Server** (de Ritwick Dey): icono de extensiones (cuadraditos) → busca "Live Server" → *Install*.
2. En VS Code: *Archivo → Abrir carpeta…* y elige la carpeta del proyecto (la que contiene `index.html`).
3. Clic derecho sobre `index.html` → **Open with Live Server** (o el botón *Go Live* abajo a la derecha).
4. Se abre `http://127.0.0.1:5500/`. Cada vez que guardes un archivo, la página se recarga sola.

> ⚠️ No abras `index.html` con doble clic (`file://`): los módulos JavaScript no funcionan así. Usa siempre Live Server.

**Verla en el móvil mientras pruebas:** con el móvil en la misma wifi, abre `http://IP-DE-TU-PC:5500` (la IP la ves con `ipconfig` en Windows, "Dirección IPv4"). Puede que el firewall de Windows pida permiso la primera vez.

---

## 3. Crear el proyecto en Supabase (paso a paso)

1. Entra en <https://supabase.com> → **Start your project** → regístrate (con GitHub es lo más cómodo). Es gratis.
2. **New project**:
   - *Name*: `calendario-dani-eva`
   - *Database Password*: genera una y guárdala (no la usa la web, pero no la pierdas).
   - *Region*: la más cercana (p. ej. *West EU (Ireland)* o *Central EU (Frankfurt)*).
   - Pulsa **Create new project** y espera 1–2 minutos.
3. Menú izquierdo → **SQL Editor** → **New query**.
4. Abre `supabase/schema.sql`, copia **todo** y pégalo.
5. **Cambia el PIN**: busca `'CAMBIA-ESTE-PIN'` y pon el vuestro (mínimo 8 caracteres; letras sin tilde, números o símbolos; sin espacios ni ñ). Ej.: `Eva+Dani-2026!`.
6. Pulsa **Run** (o Ctrl+Enter). Debe salir *Success. No rows returned*.
7. Comprueba en **Table Editor** que existen `turnos`, `eventos` y `ajustes_privados` (las tres con la etiqueta de RLS activado).

> Si en tu proyecto Supabase sale el aviso de "Data API" o "exposed schemas", asegúrate en **Project Settings → Data API** de que el esquema `public` está expuesto (lo está por defecto).

---

## 4. Dónde poner las claves

1. En Supabase: **Project Settings** (rueda dentada) → **API** / **API Keys**.
2. Copia:
   - **Project URL** → algo como `https://abcdefghijkl.supabase.co`
   - La clave pública: **anon public** (pestaña *Legacy API keys*) o la **Publishable key** (`sb_publishable_…`).
3. Abre `js/config.js` y pégalas:

```js
SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

Los nombres de la planilla (`NOMBRES_PLANILLA`) se pueden dejar vacíos para que no queden públicos en GitHub: se escriben en la pantalla "Cargar horario" y cada móvil los recuerda.

> **Si creaste la base de datos antes de los horarios a medida**, ejecuta también `supabase/actualizacion-1.sql` (añade las vacaciones `V` y los horarios con horas sueltas).

4. Guarda y recarga. Ahora te pedirá el PIN. Escríbelo una vez y queda guardado en ese dispositivo.

> 🚫 **Nunca** pongas la clave `service_role` / `secret`: esa se salta toda la seguridad y la web es pública.

---

## 5. Seguridad: cómo funciona el PIN y sus limitaciones

**Cómo funciona**

- El PIN se guarda **cifrado con bcrypt** en la tabla `ajustes_privados`. Esa tabla tiene RLS activado y **ninguna política**, así que desde la web nadie puede leerla.
- La web envía el PIN en cada petición en la cabecera `x-calendario-pin`.
- Las políticas RLS de `turnos` y `eventos` llaman a `pin_valido()`, que compara esa cabecera con el hash. Sin PIN correcto: las consultas devuelven 0 filas y cualquier escritura se rechaza.
- Además, la base de datos solo acepta valores válidos (`dani`/`eva`/`ambos`, códigos de turno conocidos, longitudes máximas).

**Limitaciones (importante que las conozcas)**

1. **La clave `anon` y la URL son públicas.** Están en `config.js`, que cualquiera puede ver en GitHub o en el navegador. Es normal en Supabase; lo que protege los datos es RLS + PIN.
2. **El PIN se puede adivinar probando (fuerza bruta).** Supabase no limita intentos en RLS. Un PIN de 4 números (10.000 combinaciones) se rompe en minutos con un script. Por eso: **usa 8 caracteres o más mezclando letras, números y símbolos.**
3. **No hay usuarios.** Cualquiera con el PIN puede ver, cambiar y borrar todo; la base de datos no sabe si lo hizo Dani o Eva.
4. **El PIN queda guardado en el dispositivo** (localStorage) en texto plano. Si alguien coge tu móvil desbloqueado, entra. Para cerrar: ⚙️ → *Olvidar el PIN*.
5. **Cambiar el PIN** obliga a escribirlo de nuevo en todos los móviles (está el SQL al final de `schema.sql`).
6. **Sin tiempo real instantáneo:** los cambios del otro llegan al abrir la app, al volver a ella o cada 60 s (el tiempo real de Supabase no ve la cabecera del PIN, así que no podría pasar el RLS).
7. **Sin conexión solo se puede mirar**, no guardar: la web lo avisa y no pierde lo que ya estaba guardado.
8. Supabase pausa los proyectos gratuitos tras ~1 semana **sin ningún uso**. Si pasa, entra en el panel y pulsa *Restore*.

Para seguridad "de verdad" habría que usar inicio de sesión (Supabase Auth) con un usuario para cada uno; pediste sin login, así que este es el mejor equilibrio.

---

## 6. Publicar en GitHub Pages (paso a paso)

1. Crea cuenta en <https://github.com> si no tienes.
2. Arriba a la derecha **+ → New repository**:
   - *Repository name*: `calendario`
   - **Public** (GitHub Pages gratis necesita repositorio público).
   - Pulsa **Create repository**.
3. Sube los archivos (la forma más fácil, sin comandos):
   - En la página del repositorio pulsa **uploading an existing file**.
   - Arrastra **el contenido** de la carpeta (`index.html`, `sw.js`, `README.md` y las carpetas `css`, `js`, `supabase`). `index.html` tiene que quedar en la raíz, no dentro de otra carpeta.
   - Abajo, **Commit changes**.
4. Activa Pages: **Settings → Pages** → en *Build and deployment*:
   - *Source*: **Deploy from a branch**
   - *Branch*: **main** y carpeta **/ (root)** → **Save**.
5. Espera 1–2 minutos y recarga esa página: aparecerá *Your site is live at* `https://TU-USUARIO.github.io/calendario/`.
6. Abre ese enlace en los dos móviles, escribid el PIN y listo.
7. **Truco:** en el móvil, menú del navegador → **Añadir a pantalla de inicio**. Se abre como una app.

**Para actualizar** la web más adelante: en GitHub entra en el archivo → icono del lápiz → edita → *Commit changes* (o vuelve a subirlo con *Add file → Upload files*). En 1–2 minutos está publicado. Si el móvil sigue mostrando la versión antigua, ciérrala del todo y ábrela otra vez.

Con Git instalado, desde la carpeta del proyecto también puedes hacerlo así:

```bash
git init
git add .
git commit -m "Calendario Dani + Eva"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/calendario.git
git push -u origin main
```

---

## 7. Cómo se usa

- **Mes / Semana**: botón arriba. Flechas ‹ › o deslizar el dedo para cambiar de periodo. **Hoy** vuelve a la fecha actual.
- **Pulsar un día**: poner o cambiar los turnos de cada uno (Dani arriba, Eva abajo), ver sus eventos y añadir uno nuevo ese día.
- **♥ borde rosa**: libráis los dos (solo se marca si los dos tenéis turnos puestos ese mes; un día sin turno cuenta como libre).
- **📥 Cargar horario**: elige de quién es, mes y año, y cómo:
  - **📊 Archivo Excel** (lo mejor para Dani): el `.xlsx` del cuadrante. Elige sola la pestaña del mes (`NOV26`…), busca la fila del nombre y la fila de números de día que tiene encima. Celda vacía = Libre.
  - **📋 Pegar desde Excel**: selecciona en Excel desde la fila de los días hasta tu fila, copia y pega.
  - **✏️ Rellenar a mano** (lo mejor para Eva): elige un turno o un horario (＋ Horario, p. ej. 17:00–22:00) y toca los días. "Días vacíos → Libre" completa el resto. Los horarios usados se recuerdan para la próxima vez.
  - **📷 Foto**: solo para hojas impresas y nítidas donde cada día tiene su letra. Con fotos de pantalla, torcidas o a mano no es fiable (Tesseract no lee letra manuscrita).
  
  Siempre se revisa en el editor del mes antes de guardar.
- **Pulsar un día → 🕒 Horas**: pone un horario a medida a mano (entrada y salida), con atajos a los horarios ya usados.
- **＋ Añadir evento**: título, emoji, fecha, horas o todo el día, notas y de quién es (Dani, Eva o Juntos). Pulsa un evento para editarlo o borrarlo.

**Consejos para la foto:** recta y de frente, buena luz, sin sombras, y si puedes recorta para que salga solo la tabla. Si no encuentra el nombre, elige la fila a mano en el desplegable "Fila de la foto usada".
