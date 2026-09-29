// Kept apart from everything that includes <Arduino.h>: its Common.h declares `int main()` with C
// linkage, and doctest's runner brings in windows.h, whose INPUT is a type, not a pin mode.

#define DOCTEST_CONFIG_IMPLEMENT
#include <doctest.h>

#include <cstring>

int hostMain();

int main(int argc, char** argv)
{
    for (int i = 1; i < argc; i++)
    {
        if (std::strcmp(argv[i], "--self-test") == 0)
        {
            doctest::Context context;
            context.applyCommandLine(argc, argv);
            return context.run();
        }
    }
    return hostMain();
}
