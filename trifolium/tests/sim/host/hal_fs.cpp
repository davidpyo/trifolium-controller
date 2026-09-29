// LittleFS over hal::flash(): a file's writes land when it is closed, nothing opens unmounted,
// and flash takes time - a write stops both cores, as the real one parks the other core to program.

#include "hal/detail.h"
#include "hal/hal.h"

#include <LittleFS.h>

FS LittleFS;

namespace
{
// Rough figures for the RP2040's QSPI flash: reads are XIP and cheap, a write erases a 4 KB sector.
constexpr uint64_t kMount_us = 5000;
constexpr uint64_t kOpen_us = 300;
constexpr uint64_t kWrite_us = 50000;
constexpr uint64_t kMetadata_us = 20000;
constexpr uint64_t kFormat_us = 500000;

// One change to flash about to land. Throws if the power goes first - and once it has gone, for
// every change after.
void landWrite(uint64_t cost_us)
{
    hal::Flash& f = hal::flash();
    if (f.powerCut)
        throw hal::PowerLoss{};
    f.writes++;
    if (f.cutPowerBeforeWrite && f.writes == f.cutPowerBeforeWrite)
    {
        f.powerCut = true;
        throw hal::PowerLoss{};
    }
    hal::detail::stall_us(cost_us);
}
} // namespace

namespace fs
{
struct FileImpl
{
    std::string path;
    std::string data;
    size_t pos = 0;
    bool writable = false;
    bool readable = false;
    bool open = true;

    ~FileImpl()
    {
        try
        {
            commit();
        }
        catch (const hal::PowerLoss&)
        {
            hal::detail::powerLost();
        }
    }

    void commit()
    {
        if (!open)
            return;
        const hal::detail::FakesOwnHeap fakes;
        open = false;
        if (!writable)
            return;
        landWrite(kWrite_us);
        hal::flash().files[path] = data;
        hal::flash().writesCommitted++;
    }
};

size_t File::write(uint8_t c)
{
    return write(&c, 1);
}

size_t File::write(const uint8_t* buf, size_t size)
{
    const hal::detail::FakesOwnHeap fakes;
    if (!impl_ || !impl_->open || !impl_->writable)
        return 0;
    if (impl_->pos > impl_->data.size())
        impl_->data.resize(impl_->pos);
    impl_->data.replace(impl_->pos, std::min(size, impl_->data.size() - impl_->pos),
                        (const char*)buf, size);
    impl_->pos += size;
    return size;
}

int File::available()
{
    if (!impl_ || !impl_->open || !impl_->readable)
        return 0;
    return (int)(impl_->data.size() - std::min(impl_->pos, impl_->data.size()));
}

int File::read()
{
    uint8_t c;
    return read(&c, 1) == 1 ? c : -1;
}

int File::peek()
{
    if (available() <= 0)
        return -1;
    return (uint8_t)impl_->data[impl_->pos];
}

void File::flush() {}

int File::read(uint8_t* buf, size_t size)
{
    const int n = std::min((int)size, available());
    if (n <= 0)
        return 0;
    memcpy(buf, impl_->data.data() + impl_->pos, n);
    impl_->pos += n;
    return n;
}

bool File::seek(uint32_t pos, SeekMode mode)
{
    if (!impl_ || !impl_->open)
        return false;
    int64_t base = mode == SeekSet ? 0 : mode == SeekCur ? (int64_t)impl_->pos
                                                          : (int64_t)impl_->data.size();
    int64_t target = base + (int64_t)pos;
    if (target < 0)
        return false;
    impl_->pos = (size_t)target;
    return true;
}

size_t File::position() const
{
    return impl_ ? impl_->pos : 0;
}

size_t File::size() const
{
    return impl_ ? impl_->data.size() : 0;
}

void File::close()
{
    if (impl_)
        impl_->commit();
    impl_.reset();
}

File::operator bool() const
{
    return impl_ && impl_->open;
}

const char* File::name() const
{
    if (!impl_)
        return "";
    const size_t slash = impl_->path.rfind('/');
    return impl_->path.c_str() + (slash == std::string::npos ? 0 : slash + 1);
}

const char* File::fullName() const
{
    return impl_ ? impl_->path.c_str() : "";
}

bool FS::begin()
{
    hal::detail::sleep_us(kMount_us);
    hal::flash().mounted = true;
    return true;
}

void FS::end()
{
    hal::flash().mounted = false;
}

bool FS::format()
{
    const hal::detail::FakesOwnHeap fakes;
    landWrite(kFormat_us);
    hal::flash().files.clear();
    hal::flash().formatted = true;
    return true;
}

File FS::open(const char* path, const char* mode)
{
    const hal::detail::FakesOwnHeap fakes;
    hal::Flash& flash = hal::flash();
    if (!flash.mounted || !path || !mode)
        return File();
    hal::detail::sleep_us(kOpen_us);

    const std::string m(mode);
    auto existing = flash.files.find(path);
    auto impl = std::make_shared<FileImpl>();
    impl->path = path;
    impl->readable = m[0] == 'r' || m.find('+') != std::string::npos;
    impl->writable = m[0] != 'r' || m.find('+') != std::string::npos;

    if (m[0] == 'r')
    {
        if (existing == flash.files.end())
            return File();
        impl->data = existing->second;
    }
    else if (m[0] == 'a')
    {
        if (existing != flash.files.end())
            impl->data = existing->second;
        impl->pos = impl->data.size();
    }
    else if (m[0] != 'w')
    {
        return File();
    }
    return File(impl);
}

bool FS::exists(const char* path)
{
    return hal::flash().mounted && hal::flash().files.count(path) != 0;
}

bool FS::remove(const char* path)
{
    if (!hal::flash().mounted || !hal::flash().files.count(path))
        return false;
    landWrite(kMetadata_us);
    hal::flash().files.erase(path);
    return true;
}

bool FS::rename(const char* pathFrom, const char* pathTo)
{
    const hal::detail::FakesOwnHeap fakes;
    hal::Flash& flash = hal::flash();
    if (!flash.mounted)
        return false;
    auto it = flash.files.find(pathFrom);
    if (it == flash.files.end())
        return false;
    landWrite(kMetadata_us);
    std::string data = std::move(it->second);
    flash.files.erase(it);
    flash.files[pathTo] = std::move(data);
    return true;
}
} // namespace fs
