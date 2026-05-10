# Future Abstractions

These fourteen namespace slots were removed from the boot catalog in Release 14 (Task #970)
because they had no lump, no handler, and no implementation — only placeholder names. The
slot numbers are freed so the namespace only contains real or reserved-for-real-work entries.

Slot numbers are **not** reserved; a future implementation may claim a different slot. These
entries are kept here so the design intent is not lost.

| Original Slot | Name       | Design Intent |
|---------------|------------|---------------|
| 28            | Family     | Encrypted parent–child messaging; a parent capability delivers messages only to registered family members |
| 29            | Schoolroom | Classroom distribution abstraction; a teacher capability pushes lessons and collects submissions from enrolled students |
| 30            | Friends     | Peer-to-peer GT sharing with explicit approval and revocation; friend lists stored as capability sets |
| 33            | Editor     | In-IDE source-code editor abstraction exposing Open/Save/Diff methods via capabilities |
| 34            | Assembler  | CLOOMC assembler-as-a-service; accepts source text, returns a lump GT |
| 35            | Debugger   | Step/breakpoint/inspect abstraction over a running Church Machine thread capability |
| 36            | Deployer   | Signed lump deployment pipeline; wraps the WebSerial FPGA flash path as a capability |
| 37            | Browser    | Capability-gated URL fetch; returns page content as a GT, enforcing same-origin-style domain policies |
| 38            | Messenger  | Asynchronous message queue abstraction; Send/Receive/Poll via GT-addressed inboxes |
| 39            | Photos     | Capability-protected image store; Upload/Fetch/Delete with per-image GTs |
| 40            | Social     | Social graph abstraction; Follow/Unfollow/Feed methods gated by mutual-capability approval |
| 41            | Video      | Streaming video capability; Play/Pause/Seek over capability-secured media lumps |
| 42            | Email      | Outbound email abstraction wrapping Resend (or equivalent); Send returns a delivery-receipt GT |
| 46            | Circle     | Group capability ring; members share a circle GT that grants equal access to a shared resource pool |
