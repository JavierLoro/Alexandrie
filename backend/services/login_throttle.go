package services

import (
	"sync"
	"time"
)

// loginThrottle limita los intentos de login por cuenta (clave = username en
// minúsculas), independientemente de la IP de origen. Tras maxLoginFailures
// fallos consecutivos, la cuenta queda bloqueada durante loginLockout. Es la
// capa de defensa que frena la fuerza bruta dirigida aunque un reverse proxy
// oculte la IP real del cliente.
//
// Es un mecanismo en memoria: se reinicia con el backend. Suficiente para
// mitigar fuerza bruta online sin necesidad de BD ni migraciones.
const (
	maxLoginFailures = 5
	loginLockout     = 15 * time.Minute
)

type throttleEntry struct {
	failures  int
	lockUntil time.Time
	last      time.Time
}

type loginThrottle struct {
	mu      sync.Mutex
	entries map[string]*throttleEntry
}

func newLoginThrottle() *loginThrottle {
	lt := &loginThrottle{entries: make(map[string]*throttleEntry)}
	go lt.janitor()
	return lt
}

// locked indica si la clave está bloqueada ahora mismo y, en su caso, el tiempo
// restante de bloqueo.
func (lt *loginThrottle) locked(key string) (bool, time.Duration) {
	lt.mu.Lock()
	defer lt.mu.Unlock()

	e, ok := lt.entries[key]
	if !ok {
		return false, 0
	}
	if remaining := time.Until(e.lockUntil); remaining > 0 {
		return true, remaining
	}
	return false, 0
}

// recordFailure suma un fallo a la clave y la bloquea si alcanza el umbral.
func (lt *loginThrottle) recordFailure(key string) {
	lt.mu.Lock()
	defer lt.mu.Unlock()

	now := time.Now()
	e, ok := lt.entries[key]
	if !ok {
		e = &throttleEntry{}
		lt.entries[key] = e
	}
	e.failures++
	e.last = now
	if e.failures >= maxLoginFailures {
		e.lockUntil = now.Add(loginLockout)
		e.failures = 0 // reinicia el contador; el bloqueo manda hasta lockUntil
	}
}

// reset limpia el estado de la clave (se llama tras un login correcto).
func (lt *loginThrottle) reset(key string) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	delete(lt.entries, key)
}

// janitor purga periódicamente las entradas inactivas para acotar la memoria.
func (lt *loginThrottle) janitor() {
	ticker := time.NewTicker(loginLockout)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		lt.mu.Lock()
		for key, e := range lt.entries {
			if now.After(e.lockUntil) && now.Sub(e.last) > loginLockout {
				delete(lt.entries, key)
			}
		}
		lt.mu.Unlock()
	}
}
