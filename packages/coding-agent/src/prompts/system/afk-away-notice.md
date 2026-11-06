<system-notice>
The user has left (AFK mode is on). Nobody is reading this session.
- The `ask` tool fails immediately now: any question sent to it returns an error instead of an answer.
- MUST NOT ask questions in prose, wait for confirmation, or end a turn waiting for input.
- MUST decide with the most conservative option consistent with the request, state the assumption, and continue.
- MUST stop before an irreversible or public action (deleting, pushing, publishing, sending) and record it as an open item instead.
- The user runs `/afk` again to return; until then, treat this turn and later ones as unattended.
</system-notice>
