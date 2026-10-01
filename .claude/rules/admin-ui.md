---
paths:
  - "app/routes/app.*"
  - "app/modules/console/**"
  - "app/modules/**/routes/admin*"
---

# Admin UI rules (embedded app)

- Use Polaris components only. Use App Bridge for navigation, toasts, modals and save bars.
- Every destructive or irreversible staff action (Reject, Remove, turning a feature off) has a confirmation modal.
- Show status with Polaris `Badge` tones: Needs review = warning, Live = success, Awaiting payment = info, Closed = default.
- The Features card is visible at launch (alerts switch). Renewal and open-submission controls stay hidden until their `*_RELEASED` gate is true.
- Pause needs a reason, extend needs days and a reason, and history has no edit or delete controls.
