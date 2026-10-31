#!/usr/bin/env python3
"""Source-contract tests for the archive importer (no live data or writes)."""
import copy
import importlib.util
import unittest

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

if __name__ == '__main__': unittest.main()
