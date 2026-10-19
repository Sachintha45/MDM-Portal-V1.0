# MDM Portal — Seed Data (from Field_List_V1.xlsx)

Generated 28 Aug 2026. CSVs use the **physical deployed column names**
(matching `mdm_portal_*` tables), minus the auto-managed audit columns
(`createdAt`, `createdBy`, `modifiedAt`, `modifiedBy`).

**Policy: only data present in the Excel is populated. Invented/default values
have been removed and are listed below under "Must fill" / "Applied defaults".**

## Files → tables

| File | Table | Rows |
|---|---|---|
| MasterDataType.csv | mdm_portal_MasterDataType | 1 |
| FieldGroup.csv | mdm_portal_FieldGroup | 110 |
| ValueTable.csv | mdm_portal_ValueTable | 101 |
| FieldMaster.csv | mdm_portal_FieldMaster | 392 |
| BPRole.csv | mdm_portal_BPRole | 4 |
| BPRoleField.csv | mdm_portal_BPRoleField | 402 |
| GridColumn.csv | mdm_portal_GridColumn | 68 |

## FK column naming (CAP convention)

- `main_group_group_id` / `sub_group_group_id` → FieldGroup.group_id
- `master_data_type_master_data_type_id` → MasterDataType.master_data_type_id
- `value_table_value_table_id` → ValueTable.value_table_id
- `role_role_id` → BPRole.role_id
- `field_field_id` → FieldMaster.field_id
- `parent_group_id_group_id` → FieldGroup.group_id (self-ref)

## Source sheet → role mapping

| Excel sheet | role_id | description |
|---|---|---|
| General Data | GEN_DATA | General Data |
| Sales General | CUST_GEN | Customer General Data |
| Sales and Distribution | CUST_SLS | Customer Sales Data |
| Company Code | CUST_FI | Customer FI Data |
| Purchases | (folded into CUST_GEN) | duplicate subset of Sales General |

## ✅ Populated from Excel (real data)

- **FieldMaster**: field_id (field name), description, length, source_table
  (Excel "Value Table" column → the SAP structure), source_field, display_type
  (SEARCH_HELP when a search help exists), group assignments (main/sub),
  `grid` flag (from "MAIN GRID FIELD").
- **FieldGroup**: Main Group → Sub Group → Sub Group2 hierarchy (3 levels).
- **ValueTable**: `value_table_id` + `description` from the "Search Help
  Source" column (e.g. T005, SKB1, M_DEBIA).
- **BPRole / BPRoleField**: the 4 roles and their field assignments + sequence.
- **GridColumn**: grid columns from the "GRID FIELD" / "MAIN GRID FIELD" flags.

## 🧩 Applied defaults (low-risk system flags — change if needed)

| Field | Value | Reason |
|---|---|---|
| MasterDataType | CUSTOMER only | all data is customer BP data; VENDOR/MATERIAL not added |
| master_data_type | CUSTOMER | all roles/fields/groups are customer-scoped |
| account_scope | CUSTOMER | matches CDS default |
| active | true | all records start active |
| read_only | false | |
| initial_bp_required | false | |
| display_type | INPUT | for fields with no search help |

## ⚠️ Blank / MUST fill before insert

| Field | Blank count | Note |
|---|---|---|
| BPRoleField.field_status | 402 | set REQUIRED / OPTIONAL / SUPPRESS per field per role |
| FieldMaster.data_type | 246 | S&D + Company Code sheets had no types; back-filled where the same field had a type elsewhere, left blank otherwise |
| ValueTable.source_table | 101 | unknown |
| ValueTable.output_key | 101 | unknown |
| ValueTable.output_desc | 101 | unknown |
| ValueTable.status | 101 | set ACTIVE |
| FieldMaster.validation_validation_id | 392 | Excel "Validation" column was empty/`?` |
| BPRoleField.default_value | 402 | not in source |
| FieldMaster.decimals | 392 | not in source |

## Known data-quality issues (source Excel)

- Role/tab typos: "Shpping", "Documets", "Accounnt", "Trasnsaction", "Busines",
  "Refernce".
- Sheet2 (151 fields) is a stale partial list — not used.
- "Sales and Distribution" & "Company Code" have no Data Types.
- Some Search Help entries were "Data Element" annotations — cleaned best-effort.

## Loading

Load in FK order:
**MasterDataType → FieldGroup → ValueTable → FieldMaster → BPRole →
BPRoleField → GridColumn**.

Use `INSERT`/bulk load mapping headers to physical columns (HANA). For CAP
`db/data/` seed CSVs, rename files to `<namespace>-<Entity>.csv` and adapt FK
columns to logical element names.

---

## 2026-09-02 — MERGED into `db/data/` (deployable seed)

Sachintha asked to merge the Excel data in with the existing seed data. The 7
CSVs above were merged into `db/data/mdm.portal-*.csv` (union, **new data wins**
on key conflicts). Verified with `cds deploy --to sqlite` → exit 0, no errors.

### Resulting row counts

| Table | Before | After |
|---|---|---|
| MasterDataType | 2 | 3 (added CUSTOMER) |
| FieldGroup | 35 | 142 |
| ValueTable | 17 | 118 |
| FieldMaster | 103 | 405 (90 overwritten by new) |
| BPRole | 6 | 10 (added 4 customer roles) |
| BPRoleField | 30 | 432 |
| GridColumn | — | 60 (new file) |

### Defaults applied to NEW rows only (to satisfy NOT NULL)

- `FieldMaster.data_type` → `STRING` (246 blanks)
- `FieldMaster.display_type` → `INPUT` (no search help)
- `BPRoleField.field_status` → `OPTIONAL` (402 blanks)
- `ValueTable.source_table` → `value_table_id` (search-help source), `output_key` → `code`, `output_desc` → `description`, `status` → `ACTIVE` (101 blanks)
- `GridColumn.data_type` → `STRING`, `description` → `column_name`, `display_type` → `INPUT`

### Data-quality fixes / dedup

- Existing `FieldGroup.master_data_type` `BUSINESS_PARTNER` → `BUSINESS PARTNER` (matched the `MasterDataType` key).
- 3 duplicate `group_id`s (`G_CUSTOMER_TEXTS*`) in the Excel collapsed to one each.
- `GridColumn` deduped on `(field, column_name)` — the "Texts" grid appeared once per sheet (4 columns × 3 sheets).

### Left as-is (pre-existing, flagged)

- Old `BPRoleField` still references 11 friendly field names not present as
  `field_id`s (e.g. `TELEPHONE`, `EMAIL`, `CITY`, `NAME1`, `BANK_KEY`) — dangling
  but loadable; not introduced by this merge.

Merge script: `scripts/merge_seed.py`.
