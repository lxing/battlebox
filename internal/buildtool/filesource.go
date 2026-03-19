package buildtool

import (
	"io/fs"
	"os"
)

type buildFileStore interface {
	fs.FS
	ReadFile(name string) ([]byte, error)
	ReadDir(name string) ([]fs.DirEntry, error)
	Stat(name string) (fs.FileInfo, error)
}

type osBuildFileStore struct{}

func (osBuildFileStore) Open(name string) (fs.File, error) {
	return os.Open(name)
}

func (osBuildFileStore) ReadFile(name string) ([]byte, error) {
	return os.ReadFile(name)
}

func (osBuildFileStore) ReadDir(name string) ([]fs.DirEntry, error) {
	return os.ReadDir(name)
}

func (osBuildFileStore) Stat(name string) (fs.FileInfo, error) {
	return os.Stat(name)
}

var buildFiles buildFileStore = osBuildFileStore{}
