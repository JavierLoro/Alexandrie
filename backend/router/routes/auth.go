package routes

import (
	"alexandrie/app"
	"alexandrie/controllers"
	"alexandrie/middlewares"
	"alexandrie/utils"

	"github.com/gin-gonic/gin"
)

func Auth(app *app.App, router *gin.RouterGroup) {
	auth := router.Group("/auth")

	authCtrl := controllers.NewAuthController(app)
	// Rate limit por IP compartido para los endpoints sensibles (anti-flood).
	rl := middlewares.RateLimit()
	auth.POST("", rl, utils.WP(authCtrl.Login))
	auth.POST("/refresh", utils.WP(authCtrl.RefreshSession))
	auth.POST("/request-reset", rl, utils.WP(authCtrl.RequestResetPassword))
	auth.POST("/reset-password", rl, utils.WP(authCtrl.ResetPassword))
	auth.POST("/logout", utils.WP(authCtrl.Logout))
	auth.POST("/logout/all", middlewares.Auth(), utils.WP(authCtrl.LogoutAllDevices))

	// Sessions route
	auth.GET("/sessions", middlewares.Auth(), utils.WP(authCtrl.GetSessions))

	// OIDC routes
	oidcCtrl := controllers.NewOIDCController(app)
	// Public routes
	auth.GET("/oidc/providers", utils.WP(oidcCtrl.GetProviders))
	auth.GET("/oidc/:provider/authorize", utils.WP(oidcCtrl.Authorize))
	auth.POST("/oidc/:provider/callback", utils.WP(oidcCtrl.Callback))

	// Protected routes (requires authentication)
	auth.GET("/oidc/linked", middlewares.Auth(), utils.WP(oidcCtrl.GetUserProviders))
	auth.POST("/oidc/:provider/link", middlewares.Auth(), utils.WP(oidcCtrl.LinkProvider))
	auth.DELETE("/oidc/:provider/unlink", middlewares.Auth(), utils.WP(oidcCtrl.UnlinkProvider))
}
