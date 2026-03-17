package appenv

import (
	"os"
	"strings"
)

const (
	EnvDev  = "dev"
	EnvProd = "prod"
)

func Current() string {
	switch strings.TrimSpace(strings.ToLower(os.Getenv("APP_ENV"))) {
	case EnvProd:
		return EnvProd
	default:
		return EnvDev
	}
}

func IsDev() bool {
	return Current() == EnvDev
}

func IsProd() bool {
	return Current() == EnvProd
}
