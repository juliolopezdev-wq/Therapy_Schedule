# Therapy Board App - Project TODO

## Database & Backend
- [x] Create Drizzle schema for patients, therapy_sessions, therapists, teams, status_flags, and board_history
- [x] Add tRPC procedures for CRUD operations on patients
- [x] Add tRPC procedures for CRUD operations on therapy sessions
- [x] Add tRPC procedures for therapist and team management
- [x] Conflict detection (computed client-side from session data)
- [x] Add tRPC procedures for board history snapshots
- [x] Write vitest tests for board logic and conflict detection (12 passing)

## Core Board UI
- [x] Build time-grid layout component (7 AM - 5 PM, 30-min increments)
- [x] Create patient row component with room number, name, and status flags
- [x] Implement color-coded therapy session tiles (PT=yellow, OT=purple, SLP=blue, Eval=green)
- [x] Build drag-and-drop functionality for rescheduling sessions (dnd-kit)
- [x] Add session creation modal (therapy type, duration, therapist assignment)
- [x] Implement session editing and deletion
- [x] Create real-time conflict detection and visual highlighting (red ring + badge)

## Patient Management
- [x] Build patient management panel with add/edit/remove functionality
- [x] Create patient form with fields: room number, name, notes, discharge status
- [x] Patient list view in management panel
- [x] Add discharge status toggle and visual indicator

## Status Flags & Indicators
- [x] Implement status flag system (DC, Name Alert, Weekend, In-Service, Appointment)
- [x] Create flag toggle UI on patient rows
- [x] Add visual styling for each flag type

## Team & Therapist Management
- [x] Therapist assignment per session
- [x] Implement team grouping system (Team 1-4, Speech Team, PRN)
- [x] Create team assignment UI for sessions

## Filtering & Views
- [x] Implement therapy type filter (All, PT, OT, SLP, Eval)
- [x] Build team filter
- [x] Create "My Schedule" personal view for individual therapists
- [x] Add view toggle controls in header

## Board History & Auditing
- [x] Implement daily board snapshot saving
- [x] Create board history viewer
- [x] Add ability to view past schedules

## Mobile Responsiveness
- [x] Optimize board layout for mobile (scrollable grid)
- [x] Mobile hint banner directing to My Schedule
- [x] Responsive navigation and controls

## UI Polish & Design
- [x] Define elegant color palette and typography system (Inter + Space Grotesk)
- [x] Create consistent spacing and layout system
- [x] Add smooth animations and transitions
- [x] Premium landing page with hero + feature cards
- [x] Loading and empty states

## Testing & Delivery
- [x] Conflict detection scenarios tested
- [x] All 12 vitest tests passing
- [x] TypeScript compiles with 0 errors
- [x] Verified board, My Schedule, Patients panel in browser
- [x] Create delivery checkpoint
- [x] Add board loading skeleton state

## UI Polish Pass 2 (user requested "make it look better")
- [x] Refine global theme: softer slate palette, better shadows, accent color
- [x] Improve session tile design (cleaner labels, therapist initials, depth)
- [x] Polish header and filter bar (better grouping, segmented controls)
- [x] Improve patient label column spacing and room badges
- [x] Refine legend and stats bar
- [x] Add subtle hover/transition micro-interactions
- [x] Re-verify in browser at desktop + mobile
- [x] Upgrade filter bar to segmented controls (Therapy / Team groups)
- [x] Refine global theme tokens (indigo accent, soft canvas, layered shadows)

## UI Polish Pass 3 (grid, padding/margin, color)
- [x] Refine grid cell sizing, borders, and consistent padding
- [x] Improve spacing/margins across header, filter bar, board, legend
- [x] Refine color treatment (cohesive palette, gridlines, row striping)
- [x] Polish session tile padding and alignment within cells
- [x] Re-verify in live browser at desktop + mobile

## UI/UX Pass 4 — Modern Hospital Style (user req)
- [x] Establish clinical design system: calm medical palette (teal/clinical-blue), neutral surfaces, clear hierarchy
- [x] Redesign header into a modern clinical app bar (logo mark, status, actions)
- [x] Refine filter/toolbar into clean clinical controls with clear active states
- [x] Modernize the grid: crisp surfaces, subtle elevation, clear time axis, status legend
- [x] Modernize session tiles for clinical clarity (type chip, room/therapist, time)
- [x] Polish patient label column, status flags, and conflict styling
- [x] Redesign landing page with a clinical, trustworthy aesthetic
- [x] Verify desktop + mobile in live browser; keep all 12 tests passing
