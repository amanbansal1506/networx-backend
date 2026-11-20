> **Original NetworX database?** See [FIX_THE_3_ERRORS.md](./FIX_THE_3_ERRORS.md).
> This release fixes missing `posts.user_id` and `connections.requester_id`
> errors caused by the legacy schema. It keeps your original NetworX tables.

# IMPORTANT: Fix Home / Profile / My Network errors

Start with [`FIX_THE_3_ERRORS.md`](FIX_THE_3_ERRORS.md). Run `npm run repair` **once** on the database used by the running backend. It upgrades existing `users` columns and checks feature tables without deleting accounts.

# NetworX Backend (reconstructed)

A Node.js / Express / PostgreSQL API for a professional networking platform. Rebuilt from the surviving `networx-backend.zip`, preserving the existing `/api/auth` contract where possible.

## What works

- Signup, login (username **or** email), cookie-based JWT, auth checks, logout, password change
- User profiles, searches, suggested users, public profiles, skills, images by URL
- Posts with public/connections-only visibility, feed, likes, comments, create/edit/delete
- Connection requests, accept/reject, cancellation, remove connection, connection lists
- Notifications for requests, accepts, likes, comments; mark read/delete
- Education and work experience CRUD
- UUID primary keys, PostgreSQL foreign keys, query parameterization, input validation, ownership checks

**Important:** The original frontend was not provided, so endpoint/JSON compatibility beyond the original auth routes is an approximation. There is no upload service; profile images and post media take HTTP(S) URLs. This is an MVP/backend foundation, not a production security audit. A real PostgreSQL integration test is still needed on your machine.

## Requirements

- Node.js 20+ (22 recommended)
- npm
- PostgreSQL 13+ (local PostgreSQL or Docker)

## Set up in five steps

```bash
cd networx-backend-rebuilt
npm install
cp .env.example .env
```

Edit `.env` to set `DATABASE_URL`, `JWT_SECRET` (at least 32 random characters), and `FRONTEND_URL` (your Next.js app's exact origin, typically `http://localhost:3000`). Generate a strong random secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

### Option A: Docker for local PostgreSQL (easy)

```bash
docker compose up -d db
```

Then put this in `.env`:

```dotenv
DATABASE_URL=postgresql://networx:networx_local_password@localhost:5432/networx
```

**Do not use those example Docker credentials in production.** If port 5432 is already in use, stop your other PostgreSQL instance or change the host port and `DATABASE_URL`.

### Option B: PostgreSQL already installed

Create a `networx` database using `createdb networx` (or your PostgreSQL GUI/psql), then set `DATABASE_URL` in `.env` to your own user/password/host/database.

### Initialize + run

```bash
npm run repair
npm run check
npm test
npm run dev
```

Browse `http://localhost:8000/health`: it should respond with `{ "ok": true, "service": "networx-backend" }`.

`db:init` adds missing profile columns to existing `users` tables and creates missing feature tables without deleting existing data. `db:doctor` verifies required columns and flags incompatible pre-existing table types. Back up important data before upgrades; do not reset an existing database.

## Calling it from Next.js

Put this in the **frontend** `.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Always send cookies along with frontend requests, for example:

```javascript
const api = process.env.NEXT_PUBLIC_API_URL;
const response = await fetch(`${api}/api/auth/user_details`, {
  credentials: 'include'
});
const data = await response.json();
```

Signup example:

```javascript
await fetch(`${api}/api/auth/signup`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'demo_user',
    full_name: 'Demo User',
    email: 'demo@example.com',
    password: 'strong-password-123'
  })
});
```

Then login with `POST /api/auth/login` and `{ "username": "demo_user", "password": "strong-password-123" }`. Login sets the `token` HTTP-only cookie for seven days.

## REST API routes

Unless otherwise noted, routes require a valid login cookie (or `Authorization: Bearer <jwt>` for API clients) and return JSON. Most successful responses have `success: true`. UUID route parameters refer to PostgreSQL UUIDs. Pagination supports `?page=1&limit=20`, max limit 50.

| Method | Endpoint | Purpose / body |
|---|---|---|
| GET | `/health` | Server health (no login) |
| POST | `/api/auth/signup` | `{ username, full_name, email, password, type? }` (no login) |
| POST | `/api/auth/login` | `{ username, password }` (no login) |
| GET | `/api/auth/check_auth` | `{ isAuthenticated, user }` |
| GET | `/api/auth/user_details` | `{ success, userData, meta }` (legacy frontend response shape) |
| POST | `/api/auth/logout` | Clear cookie (no login required) |
| PATCH | `/api/auth/change-password` | `{ current_password, new_password }` |
| GET | `/api/users/me` | Current full profile |
| PATCH | `/api/users/me` | Whitelisted profile attributes only |
| GET | `/api/users/search?q=...` | Search users by username, name or headline |
| GET | `/api/users/suggestions` | Users without an existing connection |
| GET | `/api/users/:usernameOrId` | Public profile and connection state |
| GET | `/api/users/:usernameOrId/posts` | Posts visible to current user |
| GET | `/api/feed` | Most recent visible posts |
| GET | `/api/posts` | Alias of feed |
| GET | `/api/posts/me` | Your posts |
| POST | `/api/posts` | `{ content, media_url?, visibility? }` |
| GET | `/api/posts/:id` | One post |
| PATCH | `/api/posts/:id` | Edit your post |
| DELETE | `/api/posts/:id` | Delete your post |
| POST | `/api/posts/:id/like` | Like a post |
| DELETE | `/api/posts/:id/like` | Unlike a post |
| GET | `/api/posts/:id/comments` | Comments |
| POST | `/api/posts/:id/comments` | `{ content }` |
| DELETE | `/api/posts/:id/comments/:commentId` | Delete your comment or a comment on your post |
| GET | `/api/connections` | Accepted connections |
| GET | `/api/connections/pending?direction=incoming` | Incoming/outgoing requests |
| POST | `/api/connections/request` | `{ recipient_id }` or `{ username }` |
| POST | `/api/connections/:usernameOrId/request` | Alternate request form |
| PATCH | `/api/connections/:id/accept` | Accept an incoming pending request |
| PATCH | `/api/connections/:id/reject` | Reject an incoming pending request |
| DELETE | `/api/connections/:id` | Cancel request / remove a connection |
| GET | `/api/notifications?unread=true` | List notifications plus unread count |
| PATCH | `/api/notifications/read-all` | Mark all read |
| PATCH | `/api/notifications/:id/read` | Mark one read |
| DELETE | `/api/notifications/:id` | Delete one |
| GET | `/api/profile/experience?user_id=<uuid>` | Work history (default: your own) |
| POST | `/api/profile/experience` | `{ title, company, location?, start_date?, end_date?, is_current?, description? }` |
| PATCH | `/api/profile/experience/:id` | Update own experience |
| DELETE | `/api/profile/experience/:id` | Delete own experience |
| GET | `/api/profile/education?user_id=<uuid>` | Education (default: your own) |
| POST | `/api/profile/education` | `{ school, degree?, field_of_study?, start_date?, end_date?, description? }` |
| PATCH | `/api/profile/education/:id` | Update own education |
| DELETE | `/api/profile/education/:id` | Delete own education |

### Example API requests (after login)

```javascript
// Create a post
await fetch(`${api}/api/posts`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Hello NetworX!', visibility: 'public' })
});

// Send a connection request
await fetch(`${api}/api/connections/request`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'someone_else' })
});
```

## Preserved vs added

From the ZIP, these authentication URLs and response keys were preserved: `/api/auth/signup`, `/api/auth/login` (including `user.id`), `/api/auth/check_auth` (`isAuthenticated`, `user`), `/api/auth/user_details` (`userData`, `meta.user_id`), `/api/auth/logout`, cookie named `token`, `user_id` UUID, and server port 8000.

All other endpoints were reconstructed as logical NetworX functionality. If you later provide the frontend code (especially its `fetch`/`axios` calls), its exact API paths, parameter names and JSON response shapes can be reconciled rather than guessed.

## Deployment reminders

Use real HTTPS in production and configure `COOKIE_SECURE=true` and `COOKIE_SAMESITE` for your frontend/backend site relationship (`none` only with HTTPS). Restrict `FRONTEND_URL` to actual trusted origins; comma-separated values are allowed. Use a strong `JWT_SECRET`, avoid logging credentials, configure managed PostgreSQL backups, add a managed rate limiter for public authentication endpoints, CSRF defense appropriate to your deployment, and an object-storage/media-upload service if needed. This build is a usable development baseline but does not include rate limiting, email verification, password reset or real-time messaging.
