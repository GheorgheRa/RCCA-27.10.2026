import React, { useState, useEffect } from 'react';
import { backend } from '@/api/backendClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, Trash2, Pencil, Check, X, ChevronDown, ChevronUp, KeyRound, Eye, EyeOff, UserPlus, ShieldCheck, Shield, User as UserIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PicklistManager from '../components/documents/PicklistManager';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

const PAGE_PERMISSION_KEYS = [
  { key: 'Dashboard', label: 'Dashboard' },
  { key: 'Issues', label: 'Issues' },
  { key: 'BatchMonitor', label: 'Production Monitor' },
  { key: 'Analytics', label: 'Analytics' },
  { key: 'Documents', label: 'Documents' },
  { key: 'Archive', label: 'Archive' },
  { key: 'ProductionMeeting', label: 'Production Meeting' },
  { key: 'Settings', label: 'Settings' },
  { key: 'VisualInspection', label: 'Visual Inspection AI' },
];

const ROLE_OPTIONS = [
  { value: 'user', label: 'User', icon: UserIcon, color: 'text-slate-600' },
  { value: 'admin', label: 'Admin', icon: Shield, color: 'text-blue-600' },
  { value: 'power_admin', label: 'Power Admin', icon: ShieldCheck, color: 'text-emerald-600' },
];

function roleBadge(role) {
  const opt = ROLE_OPTIONS.find(r => r.value === role) || ROLE_OPTIONS[0];
  const Icon = opt.icon;
  const colorMap = {
    power_admin: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    admin: 'bg-blue-50 text-blue-700 border-blue-200',
    user: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorMap[opt.value]}`}>
      <Icon className="w-3 h-3" />
      {opt.label}
    </span>
  );
}

function parsePerms(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function Settings() {
  const { updatePassword } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [users, setUsers] = useState([]);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [expandedPermsId, setExpandedPermsId] = useState(null);
  const [changingRoleId, setChangingRoleId] = useState(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState(null);
  const [passwordError, setPasswordError] = useState(null);

  // Add user form state
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [addingUser, setAddingUser] = useState(false);

  // Delete user confirm
  const [deleteUserId, setDeleteUserId] = useState(null);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      await updatePassword(newPassword);
      setPasswordMessage('Password updated successfully.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err.message || 'Failed to update password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const reloadUsers = async () => {
    try {
      const list = await backend.users.list();
      setUsers(list || []);
    } catch (err) {
      toast.error('Could not load users: ' + (err.message || 'unknown error'));
      setUsers([]);
    }
  };

  useEffect(() => {
    backend.auth.me().then(u => setCurrentUser(u)).catch(() => {});
    reloadUsers();
  }, []);

  const startEdit = (user) => {
    setEditingUserId(user.id);
    setEditingName(user.display_name || user.full_name || '');
  };

  const cancelEdit = () => { setEditingUserId(null); setEditingName(''); };

  const togglePerm = async (user, pageKey) => {
    const perms = parsePerms(user.page_permissions) || {};
    const allGranted = !user.page_permissions;
    const base = allGranted
      ? Object.fromEntries(PAGE_PERMISSION_KEYS.map(p => [p.key, true]))
      : { ...perms };
    base[pageKey] = !base[pageKey];
    const newPermsStr = JSON.stringify(base);
    await backend.entities.User.update(user.id, { page_permissions: newPermsStr });
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, page_permissions: newPermsStr } : u));
  };

  const saveEdit = async (userId) => {
    setSavingId(userId);
    try {
      await backend.entities.User.update(userId, { display_name: editingName });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, display_name: editingName } : u));
      setEditingUserId(null);
    } catch (err) {
      toast.error('Failed to save name: ' + (err.message || ''));
    } finally {
      setSavingId(null);
    }
  };

  const handleRoleChange = async (user, newRole) => {
    if (user.id === currentUser?.id) {
      toast.error('You cannot change your own role.');
      return;
    }
    setChangingRoleId(user.id);
    try {
      await backend.users.setRole(user.id, newRole);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u));
      toast.success(`${user.display_name || user.full_name || user.email} is now ${ROLE_OPTIONS.find(r => r.value === newRole)?.label}`);
    } catch (err) {
      toast.error(err.message || 'Failed to change role');
    } finally {
      setChangingRoleId(null);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserEmail.trim() || !newUserPassword.trim()) return;
    if (newUserPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setAddingUser(true);
    try {
      await backend.users.create({
        email: newUserEmail.trim(),
        password: newUserPassword,
        name: newUserName.trim(),
        role: newUserRole,
      });
      toast.success(`User ${newUserEmail.trim()} created successfully.`);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserRole('user');
      await reloadUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to create user.');
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (deleteUserId !== userId) {
      setDeleteUserId(userId);
      return;
    }
    try {
      await backend.users.remove(userId);
      toast.success('User deleted.');
      setDeleteUserId(null);
      await reloadUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to delete user.');
      setDeleteUserId(null);
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    const roleOrder = { power_admin: 0, admin: 1, user: 2 };
    const ra = roleOrder[a.role] ?? 3;
    const rb = roleOrder[b.role] ?? 3;
    if (ra !== rb) return ra - rb;
    return (a.display_name || a.full_name || '').localeCompare(b.display_name || b.full_name || '');
  });

  const pagesFor = (u) => {
    let perms = null;
    try { perms = u.page_permissions ? JSON.parse(u.page_permissions) : null; } catch { }
    if (!perms) return 'All pages';
    return PAGE_PERMISSION_KEYS.filter(p => perms[p.key]).map(p => p.label).join(', ') || 'None';
  };

  const handleDeleteAccount = async () => {
    if (!confirming) { setConfirming(true); return; }
    try {
      const user = await backend.auth.me();
      if (user) await backend.entities.User.delete(user.id);
    } catch (_) {}
    backend.auth.logout();
  };

  const isPowerAdmin = currentUser?.role === 'power_admin';
  const isAdminPlus = currentUser?.role === 'admin' || isPowerAdmin;

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-slate-700">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-slate-700"
            onClick={() => backend.auth.logout()}
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </Button>

          <div className="pt-2 border-t border-slate-100">
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="flex items-center gap-2 text-slate-700">
                <KeyRound className="w-4 h-4" />
                <span className="text-sm font-medium">Change Password</span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-xs text-slate-500">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="h-9 pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-xs text-slate-500">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="h-9"
                  autoComplete="new-password"
                />
              </div>
              {passwordError && <p className="text-xs text-red-600">{passwordError}</p>}
              {passwordMessage && <p className="text-xs text-green-600">{passwordMessage}</p>}
              <Button type="submit" disabled={passwordLoading || !newPassword || !confirmPassword} className="w-full h-9">
                {passwordLoading ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          </div>

          <Button
            variant="outline"
            className={`w-full justify-start gap-2 ${confirming ? 'border-red-400 text-red-600 bg-red-50' : 'text-red-500'}`}
            onClick={handleDeleteAccount}
          >
            <Trash2 className="w-4 h-4" />
            {confirming ? 'Tap again to confirm — you will be logged out' : 'Delete Account'}
          </Button>
          {confirming && (
            <p className="text-xs text-slate-400">
              This will log you out and remove your account.
            </p>
          )}
        </CardContent>
      </Card>

      {isAdminPlus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-slate-700">User Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Manual Add User Form */}
            <form onSubmit={handleAddUser} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-slate-700">
                <UserPlus className="w-4 h-4" />
                <span className="text-sm font-medium">Add New User</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  placeholder="Full name"
                  value={newUserName}
                  onChange={e => setNewUserName(e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  type="email"
                  placeholder="Email address"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  className="h-9 text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Input
                    type={showNewUserPassword ? 'text' : 'password'}
                    placeholder="Password (min 6 chars)"
                    value={newUserPassword}
                    onChange={e => setNewUserPassword(e.target.value)}
                    className="h-9 text-sm pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewUserPassword(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNewUserPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <select
                  value={newUserRole}
                  onChange={e => setNewUserRole(e.target.value)}
                  className="h-9 text-sm border border-slate-300 rounded-md px-2 bg-white"
                  disabled={!isPowerAdmin && newUserRole !== 'user'}
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value} disabled={r.value !== 'user' && !isPowerAdmin}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={addingUser || !newUserEmail.trim() || !newUserPassword.trim()} className="w-full h-9 gap-2">
                <UserPlus className="w-4 h-4" />
                {addingUser ? 'Creating...' : 'Create User'}
              </Button>
              {!isPowerAdmin && (
                <p className="text-xs text-slate-400">Admins can create regular users. Only power admins can create admin accounts.</p>
              )}
            </form>

            {/* User List */}
            <div className="space-y-2">
              {users.length === 0 && <p className="text-xs text-slate-400">No users found.</p>}
              {sortedUsers.map(user => (
                <div key={user.id}>
                  <div className="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
                    {editingUserId === user.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          className="h-7 text-sm flex-1"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(user.id); if (e.key === 'Escape') cancelEdit(); }}
                        />
                        <button onClick={() => saveEdit(user.id)} disabled={!!savingId} className="text-green-600 hover:text-green-700 p-1">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">
                            {user.display_name || user.full_name || <span className="text-slate-400 italic">No name</span>}
                          </p>
                          <p className="text-xs text-slate-400 truncate">{user.email}</p>
                        </div>
                        {/* Role selector */}
                        {user.id !== currentUser?.id ? (
                          <select
                            value={user.role}
                            onChange={e => handleRoleChange(user, e.target.value)}
                            disabled={changingRoleId === user.id}
                            className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white disabled:opacity-50"
                          >
                            {ROLE_OPTIONS.map(r => {
                              const canManage = isPowerAdmin || (user.role === 'user' && r.value === 'user');
                              return (
                                <option key={r.value} value={r.value} disabled={!canManage}>
                                  {r.label}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          roleBadge(user.role)
                        )}
                        <button onClick={() => startEdit(user)} className="text-slate-400 hover:text-blue-600 p-1">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {user.id !== currentUser?.id && (
                          <button onClick={() => setExpandedPermsId(expandedPermsId === user.id ? null : user.id)} className="text-slate-400 hover:text-blue-600 p-1">
                            {expandedPermsId === user.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {user.id !== currentUser?.id && (isPowerAdmin || user.role === 'user') && (
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className={`p-1 ${deleteUserId === user.id ? 'text-red-600' : 'text-slate-300 hover:text-red-500'}`}
                            title={deleteUserId === user.id ? 'Click again to confirm' : 'Delete user'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {expandedPermsId === user.id && user.id !== currentUser?.id && (
                    <div className="mt-1 mb-2 ml-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {PAGE_PERMISSION_KEYS.map(({ key, label }) => {
                        const perms = parsePerms(user.page_permissions);
                        const checked = perms ? !!perms[key] : true;
                        return (
                          <label key={key} className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePerm(user, key)}
                              className="accent-blue-600 w-3.5 h-3.5"
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <PicklistManager />
    </div>
  );
}
