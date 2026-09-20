# Working hours assets

The dashboard and generator are maintained here. Deploy `dashboard.template.html`
and `update.py` to `/root/VAULTS/Flint-Software/Working-Hours/`, then run the latter.
Never copy runtime JSON, CSV, or session records into this repository.

Daily totals no longer have confirmed/estimated categories. Saving a total records
an automatic-estimate baseline; later increases in the estimate add to the saved
value, clamped to 0–24 hours. Automatic estimates retain their existing 15-minute
refresh interval. Legacy totals retain their value at the first API read and then
continue tracking. The editor only saves a daily total; there is no confirmation
category or restore-estimate action.

The timer starts from the adjusted total and resets the estimate baseline when
stopped. The shared revision still rejects concurrent manual writes.

Checks: `npm run check` and `python3 working-hours/test-update.py`.
