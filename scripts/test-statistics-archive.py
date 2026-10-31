#!/usr/bin/env python3
"""Source-contract tests for the archive importer (no live data or writes)."""
import copy
import importlib.util
import unittest
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('archive', 'scripts/prepare-statistics-archive.py')
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)

class ArchiveSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = {'headers':archive.HEADERS.copy(), 'rows':[[1,2025,'venue',100]+[None]*25],
                       'sheet':'Statistics','range':'A1:AC50','spreadsheet_id':'sheet','captured_at':'2026-10-31T13:00:00Z'}
        self.source['rows'][0][23] = 17
        self.source['rows'][0][22] = 0
        self.source['rows'][0][17] = '#VALUE!'

    def test_preserve_source_without_inventing_values(self):
        row = archive.prepare(self.source,'venue')[0]
        self.assertEqual(row['metrics']['alcoholShare'],17)  # Don't recompute the old percentage.
        self.assertEqual(row['metrics']['alcoholRevenue'],0)
        self.assertIsNone(row['metrics']['bar'])
        self.assertIsNone(row['metrics']['mastersSales'])
        self.assertEqual(row['origin']['warnings'][0]['raw'],'#VALUE!')
        self.assertEqual(row['source_hash'],archive.prepare(self.source,'venue')[0]['source_hash'])
        self.source['rows'][0][3] = 200
        self.assertNotEqual(row['source_hash'],archive.prepare(self.source,'venue')[0]['source_hash'])

    def test_reject_ambiguous_or_changed_source(self):
        for change in ('venue','duplicate','headers','month','boolean'):
            source = copy.deepcopy(self.source)
            if change == 'venue': source['rows'][0][2] = 'foreign'
            if change == 'duplicate': source['rows'].append(source['rows'][0])
            if change == 'headers': source['headers'][3] = 'unexpected'
            if change == 'month': source['rows'][0][0] = 13
            if change == 'boolean': source['rows'][0][0] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                archive.prepare(source,'venue')

    def test_comment_is_data_outside_procedural_sql(self):
        self.source['rows'][0][16] = "$import$; select 'text'; -- quotation \\ and newline\n"
        rows=archive.prepare(self.source,'venue')
        target={'account_id':'cccccccc-0000-0000-0000-000000000001','venue_id':'0bd81f1b-53be-4250-af97-eb5f693b30e1','owner_id':'aaaaaaaa-0000-0000-0000-000000000001'}
        sql=archive.render_sql(rows,target)
        start=sql.index('do $import$')
        self.assertNotIn("quotation",sql[start:])
        self.assertIn("quotation",sql[:start])
        self.assertIn("pg_temp._statistics_archive_input",sql[start:])

if __name__ == '__main__': unittest.main()
