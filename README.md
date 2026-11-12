# ✂️ Agendaste

App de turnos para barberías y peluquerías con integración a Google Calendar.

## Estructura del proyecto

```
agendaste/
├── index.js                  ← Servidor principal (Express)
├── package.json
├── .env.example              ← Copialo como .env y completá tus claves
├── .gitignore
├── routes/
│   ├── auth.js               ← Login con Google OAuth
│   ├── calendar.js           ← Integración Google Calendar
│   └── appointments.js       ← CRUD de turnos
└── public/
    ├── index.html            ← Landing de Agendaste
    ├── client.html           ← Vista del cliente (reservar turno)
    ├── pages/
    │   └── admin.html        ← Panel del dueño
    ├── css/
    │   └── styles.css
    └── js/
        ├── client.js
        └── admin.js
```

## Primeros pasos

### 1. Instalá las dependencias
```bash
npm install
```

### 2. Configurá las variables de entorno
```bash
# Copiá el archivo de ejemplo
cp .env.example .env
# Editá .env con tus credenciales de Google
```

### 3. Conseguí tus credenciales de Google
1. Entrá a https://console.cloud.google.com
2. Creá un proyecto nuevo
3. Habilitá la **Google Calendar API**
4. Creá credenciales **OAuth 2.0** → Aplicación web
5. Agregá como URI de redirección: `http://localhost:3000/auth/google/callback`
6. Copiá el Client ID y Client Secret en tu `.env`

### 4. Arrancá el servidor
```bash
# Modo desarrollo (se reinicia solo al guardar cambios)
npm run dev

# Modo producción
npm start
```

### 5. Abrí en el navegador
- **Clientes:** http://localhost:3000
- **Panel dueño:** http://localhost:3000/panel

## Deploy en Render (gratis)

1. Subí el código a GitHub
2. Creá una cuenta en https://render.com
3. Nuevo → Web Service → conectá tu repo
4. Build Command: `npm install`
5. Start Command: `node index.js`
6. En **Environment** cargá las mismas variables de tu `.env`
7. Actualizá `REDIRECT_URI` con tu dominio de Render

## Planes y precio fundador

Los planes (Inicial, Pro, Plus) están en la tabla `plans` (ver `migrations/010_plans.sql`). La suscripción de Mercado Pago cobra el `monthly_price` del plan elegido, con 50% de descuento mientras `businesses.founder_until` esté vigente.

**`founder_until` se asigna a mano, y ANTES de que el negocio se suscriba:**

```sql
UPDATE businesses SET founder_until = now() + interval '12 months' WHERE id = <id del negocio>;
```

- El descuento se calcula al crear la suscripción (y al cambiar de plan). Si se asigna a un negocio que ya está suscripto, Mercado Pago le sigue cobrando el precio completo hasta su próximo cambio de plan: no se baja solo.
- Al vencer, el cron (`/api/cron/reminders`) actualiza el PreApproval al precio completo. 7 días antes le manda un mail al dueño avisándole.

## Tecnologías

- **Backend:** Node.js + Express
- **Frontend:** HTML + CSS + JavaScript vanilla
- **Auth:** Google OAuth 2.0
- **Calendar:** Google Calendar API (googleapis)
- **Deploy:** Render (recomendado, gratis)

## Roadmap

- [x] Fase 1 — Frontend funcional + API básica
- [ ] Fase 2 — Base de datos real (PostgreSQL / SQLite)
- [ ] Fase 3 — React + multi-negocio real
- [ ] Fase 4 — Notificaciones WhatsApp + email
