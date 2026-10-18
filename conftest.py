"""Loaded by pytest before any test module, so before NumPy is imported.

NumPy picks its kernels for exp, log, sin, cos and tanh from the CPU it runs on, and the
kernels differ in the last bits. The golden hashes were taken with the AVX2 ones; on an
x86 machine with AVX-512 (some CI runners) NumPy would pick others and every golden
hash would change. The simulation stays deterministic on any one machine (CLAUDE.md
§4.2); this only makes the tests' machines agree.
"""

import os
import platform

if platform.machine().lower() in ("x86_64", "amd64"):
    os.environ["NPY_DISABLE_CPU_FEATURES"] = "X86_V4 AVX512_ICL AVX512_SPR"
