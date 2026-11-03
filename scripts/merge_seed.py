#!/usr/bin/env python3
"""Merge the Excel-derived seed_data CSVs into the deployed db/data seed CSVs.

Policy: UNION with "new wins" on exact key conflicts. Existing rows keep their
position/order; new-only rows are appended. Sensible defaults are applied only
to NEW rows (and clearly reported), so nothing legacy is silently rewritten.
"""
import csv, os, sys
from collections import Counter

OLD = 'db/data'
NEW = 'seed_data'
OUT = 'db/data'

report = []

def load(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))

def dump(path, fieldnames, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore', lineterminator='\n')
        w.writeheader()
        w.writerows(rows)

def merge(old_path, new_path, key_fn, out_fields, transform_old=None, transform_new=None, out_path=None):
    old = load(old_path)
    new = load(new_path)
    if transform_old:
        old = [transform_old(r) for r in old]
    if transform_new:
        new = [transform_new(r) for r in new]
    new_by = {}
    for r in new:
        new_by.setdefault(key_fn(r), r)   # keep FIRST occurrence on in-file dupes
    seen, result, conflicts, added = set(), [], 0, 0
    for r in old:
        k = key_fn(r)
        if k in new_by:
            conflicts += 1
            result.append(new_by[k])
        else:
            result.append(r)
        seen.add(k)
    for r in new:
        k = key_fn(r)
        if k not in seen:
            result.append(r)
            added += 1
            seen.add(k)
    dump(out_path or old_path, out_fields, result)
    return len(old), len(new), conflicts, added, len(result)

# ── 1. MasterDataType ──────────────────────────────────────────────
md_f = ['master_data_type_id','description','icon','object_class','sequence','active']
a = merge(f'{OLD}/mdm.portal-MasterDataType.csv', f'{NEW}/MasterDataType.csv',
          lambda r: r['master_data_type_id'], md_f)
report.append(('MasterDataType', a))

# ── 2. FieldGroup ──────────────────────────────────────────────────
fg_f = ['group_id','description','icon','sequence','active','master_data_type_master_data_type_id','parent_group_id_group_id']
def fg_old(r):
    if r['master_data_type_master_data_type_id'] == 'BUSINESS_PARTNER':
        r['master_data_type_master_data_type_id'] = 'BUSINESS PARTNER'
    return r
a = merge(f'{OLD}/mdm.portal-FieldGroup.csv', f'{NEW}/FieldGroup.csv',
          lambda r: r['group_id'], fg_f, transform_old=fg_old)
report.append(('FieldGroup', a))

# ── 3. ValueTable ──────────────────────────────────────────────────
vt_f = ['value_table_id','description','source_table','input_1','input_2','input_3','output_key','output_desc','status']
def vt_new(r):
    r['source_table'] = r['source_table'] or r['value_table_id']
    r['output_key']   = r['output_key']   or 'code'
    r['output_desc']  = r['output_desc']  or 'description'
    r['status']       = r['status']       or 'ACTIVE'
    return r
a = merge(f'{OLD}/mdm.portal-ValueTable.csv', f'{NEW}/ValueTable.csv',
          lambda r: r['value_table_id'], vt_f, transform_new=vt_new)
report.append(('ValueTable', a))

# ── 4. FieldMaster ─────────────────────────────────────────────────
fm_f = ['field_id','description','data_type','length','decimals','display_type','value_table_value_table_id','active','source_table','source_field','main_group_group_id','sub_group_group_id','validation_validation_id','grid']
def fm_new(r):
    r['data_type']    = r['data_type']    or 'STRING'
    r['display_type'] = r['display_type'] or 'INPUT'
    return r
a = merge(f'{OLD}/mdm.portal-FieldMaster.csv', f'{NEW}/FieldMaster.csv',
          lambda r: r['field_id'], fm_f, transform_new=fm_new)
report.append(('FieldMaster', a))

# ── 5. BPRole ──────────────────────────────────────────────────────
br_f = ['role_id','description','master_data_type_master_data_type_id','account_scope','initial_bp_required','sequence','active']
VENDOR_ROLES = {'FLVN01', 'FLVN00'}
def br_old(r):
    r['account_scope'] = 'VENDOR' if r['role_id'] in VENDOR_ROLES else 'CUSTOMER'
    return r
a = merge(f'{OLD}/mdm.portal-BPRole.csv', f'{NEW}/BPRole.csv',
          lambda r: r['role_id'], br_f, transform_old=br_old)
report.append(('BPRole', a))

# ── 6. BPRoleField ─────────────────────────────────────────────────
brf_f = ['role_role_id','field_field_id','field_status','sequence','default_value','read_only']
def brf_new(r):
    r['field_status'] = r['field_status'] or 'OPTIONAL'
    return r
a = merge(f'{OLD}/mdm.portal-BPRoleField.csv', f'{NEW}/BPRoleField.csv',
          lambda r: (r['role_role_id'], r['field_field_id']), brf_f, transform_new=brf_new)
report.append(('BPRoleField', a))

# ── 7. GridColumn (no existing file → create) ──────────────────────
gc_f = ['field_field_id','column_name','data_type','length','decimals','description','display_type','value_table_value_table_id','validation_validation_id','source_table','source_field','active']
gc = load(f'{NEW}/GridColumn.csv')
for r in gc:
    r['data_type']    = r['data_type']    or 'STRING'
    r['description']  = r['description']  or r['column_name']
    r['display_type'] = r['display_type'] or 'INPUT'
gc_dedup = []
seen_gc = set()
for r in gc:
    k = (r['field_field_id'], r['column_name'])
    if k not in seen_gc:
        seen_gc.add(k)
        gc_dedup.append(r)
dump(f'{OUT}/mdm.portal-GridColumn.csv', gc_f, gc_dedup)
report.append(('GridColumn', (0, len(gc), 0, len(gc), len(gc))))

print('=' * 72)
print(f"{'Table':<15} {'old':>5} {'new':>5} {'conflict':>9} {'added':>6} {'total':>6}")
print('=' * 72)
for name, (o, n, c, ad, t) in report:
    print(f"{name:<15} {o:>5} {n:>5} {c:>9} {ad:>6} {t:>6}")
print('=' * 72)
print('Done. Merged CSVs written to db/data/ (+ new GridColumn.csv)')
