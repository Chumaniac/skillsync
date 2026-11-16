import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

class PortableBoundaries(unittest.TestCase):
    def test_portable_profile_cannot_launch_source_or_external_program(self):
        import copy, json
        builder = load('build_app')
        profile = json.loads((ROOT / 'portable.json').read_text())
        builder.validate_portable_profile(profile)
        for key, value in [('executable', '/tmp/foreign-node'), ('workingDirectory', '/tmp/foreign'), ('arguments', ['/tmp/foreign.js']), ('smokeArguments', ['/tmp/foreign.js'])]:
            changed = copy.deepcopy(profile); changed['launch'][key] = value
            with self.assertRaisesRegex(ValueError, 'PORTABLE_LAUNCH_PROFILE_INVALID'):
                builder.validate_portable_profile(changed)
    def test_node_license_is_bounded_regular_file_and_inside_detected_prefix(self):
        runtime = load('prepare_runtime')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); prefix = root / 'node'; prefix.mkdir()
            license = prefix / 'LICENSE'; license.write_text('upstream Node license')
            self.assertEqual(runtime.validate_node_license(license, prefix), license)
            link = prefix / 'linked'; link.symlink_to(license)
            with self.assertRaisesRegex(ValueError, 'NODE_LICENSE_INVALID'):
                runtime.validate_node_license(link, prefix)
            outside = root / 'external'; outside.write_text('outside')
            with self.assertRaisesRegex(ValueError, 'NODE_LICENSE_INVALID'):
                runtime.validate_node_license(outside, prefix)
            for contents in ['', 'x' * (4 * 1024 * 1024 + 1)]:
                license.write_text(contents)
                with self.assertRaisesRegex(ValueError, 'NODE_LICENSE_INVALID'):
                    runtime.validate_node_license(license, prefix)

if __name__ == '__main__': unittest.main()
