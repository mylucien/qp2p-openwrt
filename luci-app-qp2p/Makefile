# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI 支持 for qp2p
LUCI_DESCRIPTION:=qp2p 私有组网的路由器侧界面（概览 / 设置 / 成员 / 日志）
LUCI_DEPENDS:=+luci-base +qp2p
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=lucien

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
