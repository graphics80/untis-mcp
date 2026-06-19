# untis-mcp

HTTP MCP server that gives Claude AI read access to WebUntis school scheduling data. Runs as a Docker container behind a reverse proxy. Teachers connect through claude.ai with a single secret URL — no login form, no WebUntis credentials required on their end.

Live at **[https://mcp.it.bzz.ch/untis](https://mcp.it.bzz.ch/untis)** (BZZ Berufsschule Zürich).

For deployment instructions see [DEPLOY.md](DEPLOY.md).

---

## How it works

```
claude.ai
    │
    │  Streamable HTTP (no OAuth)
    │  connector URL: https://<host>/untis/<MCP_SECRET>
    ▼
untis-mcp  (Docker, Node.js/TypeScript)
    │  src/server.ts          — Express HTTP server, secret-gated MCP endpoint
    │  src/mcp-handlers.ts    — MCP tool definitions
    │  src/untis-client.ts    — WebUntis API wrapper with auto-reconnect
    │  src/http/
    │    transport-manager.ts — StreamableHTTP MCP transport (one per session)
    │
    │  WebUntis JSON-RPC (shared service account)
    ▼
bzz.webuntis.com
```

**Auth model:** The path secret (`MCP_SECRET`) *is* the authentication — anyone who knows the full URL `https://<host>/untis/<MCP_SECRET>` can use the server, so treat it like a password. Requests to the wrong (or missing) secret get a flat `404`. Behind the scenes, all WebUntis queries run through a single shared service account; teachers need no individual WebUntis logins. Because the secret rides in the URL path, keep it out of access logs (see [DEPLOY.md](DEPLOY.md)) and always serve over HTTPS.

**Sessions:** Each MCP client connection gets its own WebUntis session, keyed by the transport-assigned `Mcp-Session-Id`. Idle sessions are swept after 24h; clients transparently re-initialize (the transport answers `404` to a stale session id, per the MCP spec). WebUntis session expiry is handled transparently with auto-reconnect.

---

## Tools (30 total)

| Tool | Description |
|------|-------------|
| `getTimetable` | Timetable for a class, teacher, or room over a date range |
| `getWeekOverview` | Full week (Mon–Fri) timetable grouped by day |
| `getYearlyTimetableForClass` | All lessons for a class across a full school year, split into four quarters |
| `getTeachers` | All teachers |
| `getClasses` | All classes |
| `getClassesOnDay` | All classes that have school on a specific date (with lesson count) |
| `getClassesAtLocationOnDay` | All classes with a lesson at a given location/campus on a date (with lesson count and rooms) |
| `classOnWeekDay` | All classes that have school on a given weekday (German name or 1–7) |
| `getCompanionClasses` | A class's linked companion classes (Partnerklassen) with a merged `fetchIds` array; flags the IA BM/ABU choice when ambiguous |
| `getRooms` | All rooms |
| `getSubjectsList` | All subjects offered |
| `getLessonsForSubject` | All scheduled lessons for a subject (optionally one class) over a date range, grouped by date and class |
| `getTimegrid` | Lesson periods (start/end times per weekday) |
| `getHolidays` | School holidays and vacation periods |
| `getDepartments` | School departments |
| `getSchoolYear` | Current and all available school years |
| `getSchoolQuarters` | The school year's four quarters (Quartale) with date ranges, inferred from module changes |
| `getSemesters` | The school year's two semesters with the semester-change date |
| `getTeacherSubjects` | Which subjects each teacher teaches (scans timetable history) |
| `getTeachersForClass` | All teachers who teach a specific class (scans recent timetable) |
| `getClassLeadership` | A class's homeroom teacher(s) (Klassenlehrer) and responsible department head (zuständige Abteilungsleitung / AL), read from the class's `teacher1`/`teacher2` fields |
| `getTeacherSchedule` | A teacher's full-year schedule as blocks (quarter, subject, class, weekday, time, half-day) |
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
| `MCP_SECRET` | No | Secret URL token (the auth). Auto-generated at startup if unset — set it to keep a stable connector URL |
| `BASE_URL` | Yes | Public HTTPS URL of this server (no trailing slash) |
| `PORT` | No | HTTP port (default: `3000`) |
| `SCHOOL_TIMEZONE` | No | IANA timezone (default: `Europe/Zurich`) |
| `SCHOOL_EMAIL_DOMAIN` | No | Domain for deriving teacher emails as `firstname.lastname@domain` (e.g. `bzz.ch`). If unset, the `email` field is omitted |
| `RATE_LIMIT_WINDOW_MS` | No | Rate-limit window for the MCP endpoint in ms (default: `60000`) |
| `RATE_LIMIT_MAX` | No | Max requests per window per client (default: `120`) |

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

**Connector won't connect / returns 404**
Confirm the URL ends with the exact `MCP_SECRET` (`https://<host>/untis/<secret>`). A wrong or missing secret returns `404` by design. If `MCP_SECRET` is unset, the server prints a fresh random one to the logs on every restart — set it in `.env.production` to keep the URL stable.

---

## License

MIT
