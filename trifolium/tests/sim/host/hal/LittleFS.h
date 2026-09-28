#pragma once
#include <Arduino.h>

#include <memory>
#include <string>

// arduino-pico's FS/File API over hal::flash(). Like LittleFS, a file's writes land when it is
// closed, and nothing opens while the filesystem is unmounted.
namespace fs
{
enum SeekMode
{
    SeekSet = 0,
    SeekCur = 1,
    SeekEnd = 2
};

struct FileImpl;

class File : public Stream
{
  public:
    File() = default;
    explicit File(std::shared_ptr<FileImpl> impl) : impl_(std::move(impl)) {}

    size_t write(uint8_t c) override;
    size_t write(const uint8_t* buf, size_t size) override;
    using Print::write;
    int available() override;
    int read() override;
    int peek() override;
    void flush() override;

    int read(uint8_t* buf, size_t size);
    size_t readBytes(char* buffer, size_t length) { return (size_t)read((uint8_t*)buffer, length); }

    bool seek(uint32_t pos, SeekMode mode);
    bool seek(uint32_t pos) { return seek(pos, SeekSet); }
    size_t position() const;
    size_t size() const;
    void close();
    operator bool() const;
    const char* name() const;
    const char* fullName() const;
    bool isFile() const { return (bool)*this; }
    bool isDirectory() const { return false; }

  private:
    std::shared_ptr<FileImpl> impl_;
};

class FS
{
  public:
    bool begin();
    void end();
    bool format();

    File open(const char* path, const char* mode);
    File open(const String& path, const char* mode) { return open(path.c_str(), mode); }
    bool exists(const char* path);
    bool exists(const String& path) { return exists(path.c_str()); }
    bool remove(const char* path);
    bool remove(const String& path) { return remove(path.c_str()); }
    bool rename(const char* pathFrom, const char* pathTo);
    bool rename(const String& pathFrom, const String& pathTo)
    {
        return rename(pathFrom.c_str(), pathTo.c_str());
    }
    bool mkdir(const char* path) { return true; }
    bool mkdir(const String& path) { return true; }
    bool rmdir(const char* path) { return true; }
    bool rmdir(const String& path) { return true; }
};
} // namespace fs

using fs::File;
using fs::FS;
using fs::SeekCur;
using fs::SeekEnd;
using fs::SeekMode;
using fs::SeekSet;

extern FS LittleFS;
