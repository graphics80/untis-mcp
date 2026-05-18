# untis-mcp

Model Context Protocol (MCP) server that gives Claude AI read access to WebUntis school scheduling data. Query timetables, find substitute teachers, check room availability, and more — in natural language.

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

## Usage as MCP (Claude Desktop / Claude Code)

No install, no clone, no build. Credentials are passed directly via the MCP client config — no `.env` file needed.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "untis": {
      "command": "npx",
      "args": ["-y", "untis-mcp"],
      "env": {
        "WEBUNTIS_SCHOOL": "your-school-name",
        "WEBUNTIS_USERNAME": "your-username",
        "WEBUNTIS_PASSWORD": "your-password",
        "WEBUNTIS_BASE_URL": "your-school.webuntis.com",
        "SCHOOL_TIMEZONE": "Europe/Vienna"
      }
    }
  }
}
```

Restart Claude Desktop after saving. `npx` downloads and runs the server automatically on first use.

### Claude Code (CLI)

```bash
claude mcp add untis -e WEBUNTIS_SCHOOL=your-school -e WEBUNTIS_USERNAME=your-username \
  -e WEBUNTIS_PASSWORD=your-password -e WEBUNTIS_BASE_URL=your-school.webuntis.com \
  -- npx -y untis-mcp
```

---

## Development Setup

### Prerequisites

- Node.js 18+
- A WebUntis account with API access

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:

```
WEBUNTIS_SCHOOL=your-school-name
WEBUNTIS_USERNAME=your-username
WEBUNTIS_PASSWORD=your-password
WEBUNTIS_BASE_URL=your-school.webuntis.com
SCHOOL_TIMEZONE=Europe/Vienna
```

> The `.env` file is only used for local development. When running as an MCP server, credentials are injected by the MCP client (see above).

### 3. Build

```bash
npm run build
```

### 4. Run locally

```bash
npm start
```

The server starts on stdio and waits for MCP messages.

### Dev mode (ts-node, no build step)

```bash
npm run dev
```

---

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `WEBUNTIS_SCHOOL` | Yes | School identifier | `BZZ` |
| `WEBUNTIS_USERNAME` | Yes | WebUntis login | `teacher_username` |
| `WEBUNTIS_PASSWORD` | Yes | WebUntis password | — |
| `WEBUNTIS_BASE_URL` | Yes | WebUntis server domain | `bzz.webuntis.com` |
| `SCHOOL_TIMEZONE` | No | IANA timezone (default: `Europe/Vienna`) | `Europe/Zurich` |

---

## Architecture

```
Claude AI
    │
    │ MCP Protocol (stdio)
    ▼
MCP Server (Node.js/TypeScript)
    │  src/server.ts — tool definitions, input validation (Zod), request handling
    │  src/untis-client.ts — WebUntis API wrapper
    │  src/types.ts — TypeScript interfaces
    │
    │ JSON-RPC
    ▼
WebUntis API
    │
    ▼
School Data
```

**Key design decisions:**
- All credentials validated at startup — server exits immediately if any are missing
- Time inputs use WebUntis `Hmm` format (e.g. `800` = 08:00, `1015` = 10:15)
- Concurrent API calls limited to batches of 5 to avoid overwhelming the server
- `getExams`, `getHomework`, `getNews` depend on school-side configuration and may return empty results

---

## Troubleshooting

**Authentication fails**
- Verify `WEBUNTIS_BASE_URL` is the correct subdomain for your school (e.g. `bzz.webuntis.com`, not just `webuntis.com`)
- Confirm the account has API access (contact your Untis administrator)

**`getExams` / `getHomework` / `getNews` return empty**
- These depend on features being enabled on your school's Untis instance
- Contact your school IT department to enable data sharing via API

**`findSubstituteTeachers` is slow**
- It scans `qualificationDays` (default 14) of class timetables to determine subject qualifications
- Reduce `qualificationDays` for faster results at the cost of accuracy

**Session timeout**
- WebUntis sessions expire after ~10 minutes of inactivity
- The server does not auto-reconnect; restart it if you encounter session errors

---

## Security

- Credentials are never hardcoded — always passed via environment variables
- All tool inputs are validated with Zod schemas before processing
- Error messages are sanitized (no internal stack traces sent to the MCP client)
- Never commit `.env` — it's in `.gitignore`

---

## License

MIT
