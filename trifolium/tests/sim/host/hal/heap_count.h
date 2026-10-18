// Force-included into every [env:sim] source by native_env.py, so the firmware's, the libraries'
// and the fakes' calls to malloc, calloc, realloc and free reach hal_heap.cpp's counted versions.
// operator new is replaced there too. The C library is not renamed: what it allocates for itself
// is not the firmware's heap.

#pragma once

// Declared first, so that the C library's own declarations are not renamed.
#include <stdlib.h>
#ifdef __cplusplus
#include <cstdlib>
extern "C"
{
#endif
void* hal_malloc(size_t n);
void* hal_calloc(size_t count, size_t n);
void* hal_realloc(void* p, size_t n);
void hal_free(void* p);
#ifdef __cplusplus
}
// For std::malloc and the rest, which the macros below rename too.
namespace std
{
using ::hal_calloc;
using ::hal_free;
using ::hal_malloc;
using ::hal_realloc;
} // namespace std
#endif

#define malloc hal_malloc
#define calloc hal_calloc
#define realloc hal_realloc
#define free hal_free
