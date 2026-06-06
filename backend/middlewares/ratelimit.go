package middlewares

import (
	"alexandrie/utils"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimit limita el número de peticiones por IP en una ventana fija. Es la
// capa de borde anti-flood para los endpoints de autenticación: corta ráfagas
// rápidas desde una misma IP antes de llegar al handler.
//
// Su eficacia depende de que c.ClientIP() resuelva la IP real del cliente
// (config de proxies de confianza). La protección de fondo contra fuerza bruta
// dirigida la aporta el cooldown por cuenta del servicio de auth.
//
// Mecanismo en memoria (se reinicia con el backend), sin dependencias externas.
const (
	rateWindow  = 5 * time.Minute
	maxAttempts = 20
)

type rateWindowEntry struct {
	count int
	start time.Time
}

type ipRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateWindowEntry
}

// allow registra una petición de la IP y devuelve si está permitida junto con
// el tiempo restante de la ventana cuando se rechaza.
func (rl *ipRateLimiter) allow(ip string) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.entries[ip]
	if !ok || now.Sub(e.start) >= rateWindow {
		rl.entries[ip] = &rateWindowEntry{count: 1, start: now}
		return true, 0
	}

	if e.count >= maxAttempts {
		return false, rateWindow - now.Sub(e.start)
	}
	e.count++
	return true, 0
}

func (rl *ipRateLimiter) janitor() {
	ticker := time.NewTicker(rateWindow)
	defer ticker.Stop()
	for range ticker.C {
		now := time.Now()
		rl.mu.Lock()
		for ip, e := range rl.entries {
			if now.Sub(e.start) >= rateWindow {
				delete(rl.entries, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// RateLimit construye un middleware con un store compartido. Llamar una vez y
// reutilizar el handler en varias rutas para que compartan el mismo límite.
func RateLimit() gin.HandlerFunc {
	limiter := &ipRateLimiter{entries: make(map[string]*rateWindowEntry)}
	go limiter.janitor()

	return func(c *gin.Context) {
		allowed, retryAfter := limiter.allow(c.ClientIP())
		if !allowed {
			seconds := int(retryAfter.Seconds())
			if seconds < 1 {
				seconds = 1
			}
			c.Header("Retry-After", strconv.Itoa(seconds))
			c.JSON(http.StatusTooManyRequests, utils.Error("Too many requests, please try again later."))
			c.Abort()
			return
		}
		c.Next()
	}
}
