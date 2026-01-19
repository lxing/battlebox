package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type CertManager struct {
	sync.RWMutex
	cert      *tls.Certificate
	lastFetch time.Time
	host      string
}

func IsTailscaleAvailable() bool {
	cmd := exec.Command("tailscale", "status", "--json")
	output, err := cmd.Output()
	if err != nil {
		return false
	}

	var status struct {
		BackendState string `json:"BackendState"`
		Self         struct {
			Online bool `json:"Online"`
		} `json:"Self"`
	}

	if err := json.Unmarshal(output, &status); err != nil {
		return false
	}

	return status.BackendState == "Running" && status.Self.Online
}

func GetTailscaleHostname() string {
	cmd := exec.Command("tailscale", "status", "--json")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}

	var status struct {
		Self struct {
			DNSName string `json:"DNSName"`
		} `json:"Self"`
	}

	if json.Unmarshal(output, &status) == nil {
		return strings.TrimSuffix(status.Self.DNSName, ".")
	}

	return ""
}

func GetTailscaleIP() string {
	cmd := exec.Command("tailscale", "ip", "-4")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func NewCertManager(host string) *CertManager {
	return &CertManager{host: host}
}

func (cm *CertManager) fetchCert() error {
	cmd := exec.Command("tailscale", "cert", "--cert-file", "-", "--key-file", "-", cm.host)
	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("tailscale cert failed: %s", string(exitErr.Stderr))
		}
		return fmt.Errorf("failed to run tailscale cert: %w", err)
	}

	outputStr := string(output)

	// Find the private key section
	keyStart := strings.Index(outputStr, "-----BEGIN EC PRIVATE KEY-----")
	if keyStart == -1 {
		keyStart = strings.Index(outputStr, "-----BEGIN RSA PRIVATE KEY-----")
	}
	if keyStart == -1 {
		keyStart = strings.Index(outputStr, "-----BEGIN PRIVATE KEY-----")
	}
	if keyStart == -1 {
		return fmt.Errorf("could not find private key in certificate output")
	}

	certPEM := strings.TrimSpace(outputStr[:keyStart])
	keyPEM := strings.TrimSpace(outputStr[keyStart:])

	cert, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		return fmt.Errorf("failed to create certificate: %w", err)
	}

	cm.Lock()
	cm.cert = &cert
	cm.lastFetch = time.Now()
	cm.Unlock()

	return nil
}

func (cm *CertManager) GetCertificate(clientHello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	cm.RLock()
	cert := cm.cert
	last := cm.lastFetch
	cm.RUnlock()

	// Refresh if cert is older than 12 hours or doesn't exist
	if time.Since(last) > 12*time.Hour || cert == nil {
		if err := cm.fetchCert(); err != nil {
			if cert != nil {
				return cert, nil
			}
			return nil, err
		}
		cm.RLock()
		cert = cm.cert
		cm.RUnlock()
	}
	return cert, nil
}
