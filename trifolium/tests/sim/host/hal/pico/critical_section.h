#pragma once
// The Pico SDK's critical section, a no-op here: the fake's cores only switch where one delays or
// reads the clock, and the code a critical section guards does neither.

typedef struct
{
    int unused;
} critical_section_t;

inline void critical_section_init(critical_section_t*) {}
inline void critical_section_enter_blocking(critical_section_t*) {}
inline void critical_section_exit(critical_section_t*) {}
