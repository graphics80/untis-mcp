# untis-mcp

HTTP MCP server that gives Claude AI read access to WebUntis school scheduling data. Runs as a Docker container behind a reverse proxy. Teachers connect through claude.ai using OAuth — no WebUntis credentials required on their end.

Live at **[https://mcp.it.bzz.ch/untis](https://mcp.it.bzz.ch/untis)** (BZZ Berufsschule Zürich).

For deployment instructions see [DEPLOY.md](DEPLOY.md).

---

## How it works

```
claude.ai
    │
    │  OAuth 2.0 Authorization Code + PKCE
    │  (teacher logs in with MCP credentials)
    ▼
untis-mcp  (Docker, Node.js/TypeScript)
    │  src/server.ts          — Express HTTP server, OAuth endpoints, MCP endpoint
    │  src/mcp-handlers.ts    — 20 MCP tool definitions
    │  src/untis-client.ts    — WebUntis API wrapper with auto-reconnect
    │  src/http/
    │    oauth-store.ts       — Auth codes + access tokens (in-memory, TTL'd)
    │    transport-manager.ts — StreamableHTTP MCP transport
    │
    │  WebUntis JSON-RPC (shared service account)
    ▼
bzz.webuntis.com
```

**Auth model:** Teachers authenticate with admin-defined MCP credentials (`MCP_USERS`). Behind the scenes, all WebUntis queries run through a single shared service account. Teachers do not need individual WebUntis logins.

**Sessions:** Each access token gets its own WebUntis session. Sessions live for 1 hour (matching the token TTL) and are swept automatically. WebUntis session expiry is handled transparently with auto-reconnect.

---

## Tools (20 total)

| Tool | Description |
|------|-------------|
| `getTimetable` | Timetable for a class, teacher, or room over a date range |
| `getWeekOverview` | Full week (Mon–Fri) timetable grouped by day |
| `getTeachers` | All teachers |
| `getClasses` | All classes |
| `getRooms` | All rooms |
| `getStudents` | All students |
| `getSubjectsList` | All subjects offered |
| `getTimegrid` | Lesson periods (start/end times per weekday) |
| `getHolidays` | School holidays and vacation periods |
| `getDepartments` | School departments |
| `getSchoolYear` | Current and all available school years |
| `getTeacherSubjects` | Which subjects each teacher teaches (scans timetable history) |
| `findSubstituteTeachers` | Teachers qualified for a subject AND free at a given time slot |
| `checkTeacherAvailability` | Whether a teacher is free at a specific time, and what they're teaching if not |
| `findAvailableRooms` | All rooms free at a given date and time slot |
| `getTeacherWorkload` | Lesson count and subject distribution for a teacher over a date range |
| `getAbsences` | Absence records for a date range |
| `getExams` | Exams/tests for a date range (school-dependent) |
| `getHomework` | Homework assignments for a date range (school-dependent) |
| `getNews` | Daily messages from the WebUntis news widget (school-dependent) |

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBUNTIS_SCHOOL` | Yes | School identifier (e.g. `BZZ`) |
| `WEBUNTIS_BASE_URL` | Yes | WebUntis server domain (e.g. `bzz.webuntis.com`) |
| `WEBUNTIS_USERNAME` | Yes | Shared service account username |
| `WEBUNTIS_PASSWORD` | Yes | Shared service account password |
| `MCP_USERS` | Yes | Teacher logins: `user1:pass1,user2:pass2` |
| `BASE_URL` | Yes | Public HTTPS URL of this server (no trailing slash) |
| `PORT` | No | HTTP port (default: `3000`) |
| `SCHOOL_TIMEZONE` | No | IANA timezone (default: `Europe/Zurich`) |

See `.env.production.example` for a template.

---

## Development

```bash
npm install
npm run build    # compile TypeScript → dist/
npm start        # run HTTP server (reads .env)
npm test         # run test suite
```

---

## Troubleshooting

**`getExams` / `getHomework` / `getNews` return empty**
These depend on features being enabled on your school's Untis instance — contact school IT.

**`findSubstituteTeachers` is slow**
It scans `qualificationDays` (default 14) of timetable history. Pass a smaller value for faster results.

**Teacher can't log in**
Check that their username/password appears correctly in `MCP_USERS` in `.env.production` on the server.

---

## License

MIT
